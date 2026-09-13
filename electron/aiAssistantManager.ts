import Anthropic from '@anthropic-ai/sdk'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { readJsonFile, writeJsonFile } from './fsUtils'
import { requireProjectDir, touchProject } from './projectPaths'
import type { SettingsManager } from './settingsManager'
import type { PromptLabKind } from './promptLabTypes'

// --- Data model -------------------------------------------------------
//
// Phase 4's AI Assistant: a small chat panel available in the Idea tab, the
// Script tab, each Prompt Lab sub-tab (Grok/Suno), and the unified SFX
// panel — one context per place it appears. Conversation history is kept
// per project, per context, in each project's new `aiAssistant/` folder:
//
//   aiAssistant/
//     idea.json        suno.json
//     script.json      elevenlabs.json
//     grok.json
//
// 'elevenlabs' stays its own context even though the Phase 5 SFX merge
// folded the old ElevenLabs prompt-lab *kind* into the unified SFX system
// (electron/sfxLibraryManager.ts) — the AI Assistant that helps write an
// ElevenLabs SFX generation prompt is still a distinct, useful context, it's
// just embedded in the SFX panel now instead of its own prompt-lab tab. It's
// no longer a `PromptLabKind`, so it's listed explicitly here rather than
// inherited.
//
// This deliberately does NOT auto-feed other project data (the script, shot
// prompts, etc.) into the request — each context's system prompt describes
// its role in general terms, and the only content sent to Anthropic is what
// the user actually types in the chat. Per Phase 4's scope in TODO.md,
// smarter context-aware assistance is Phase 8's job, building on this
// phase's API plumbing.
//
// The Anthropic API key is read from SettingsManager (safeStorage-encrypted,
// entered in the Settings screen) and never leaves the main process — this
// file is the only place that calls the Anthropic API.

export type AiAssistantContext = 'idea' | 'script' | PromptLabKind | 'elevenlabs'

export const AI_ASSISTANT_CONTEXTS: AiAssistantContext[] = ['idea', 'script', 'grok', 'suno', 'elevenlabs']

export interface AiMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
}

const AI_MODEL = 'claude-opus-5'
const MAX_RESPONSE_TOKENS = 4096

const SYSTEM_PROMPTS: Record<AiAssistantContext, string> = {
  idea: `You are a creative brainstorming assistant helping a solo creator develop ideas, premises, and
plots for short-form videos. Offer concrete, varied suggestions and ask focused follow-up questions
rather than generic ones. Keep responses skimmable — favor short paragraphs or bullet lists.`,
  script: `You are a writing assistant helping a solo creator draft and revise a script for a short-form
video. Help with structure, pacing, dialogue, and voice. When asked to write or rewrite script text,
give text that can be pasted directly into the script with minimal editing.`,
  grok: `You are helping a solo creator write and refine a text-to-video prompt to paste into Grok's
video generation tool. Focus on concrete visual details: subject, action/motion, camera behavior,
lighting, and style. When asked for a prompt, give one ready to paste, not a description of one.`,
  suno: `You are helping a solo creator write a music-generation prompt (style/genre description, and
optionally lyrics) to paste into Suno. When asked for a prompt or lyrics, give text ready to paste,
not a description of it.`,
  elevenlabs: `You are helping a solo creator write a sound-effect description to paste into ElevenLabs'
audio generation tool, or a good search term for finding a similar sound on a free/licensed SFX site.
Favor short, concrete, sensory descriptions of the sound itself. When asked for one, give text ready
to paste or search with, not a description of it.`,
}

function conversationPath(dir: string, context: AiAssistantContext): string {
  return path.join(dir, 'aiAssistant', `${context}.json`)
}

/** Turns a thrown error from the Anthropic SDK (or elsewhere) into a message safe to show the user. */
function describeError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) {
    return 'Anthropic rejected the API key. Check the key in Settings.'
  }
  if (err instanceof Anthropic.RateLimitError) {
    return 'Anthropic rate-limited this request. Wait a moment and try again.'
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return 'Could not reach the Anthropic API. Check your internet connection and try again.'
  }
  if (err instanceof Anthropic.APIError) {
    return `Anthropic API error (${err.status ?? 'unknown status'}): ${err.message}`
  }
  if (err instanceof Error) return err.message
  return String(err)
}

export class AiAssistantManager {
  constructor(private settings: SettingsManager) {}

  async listMessages(projectId: string, context: AiAssistantContext): Promise<AiMessage[]> {
    const dir = await requireProjectDir(projectId)
    return readJsonFile<AiMessage[]>(conversationPath(dir, context), [])
  }

  /** Sends a user message, calls the Anthropic API, and persists both the question and the reply. */
  async sendMessage(projectId: string, context: AiAssistantContext, text: string): Promise<AiMessage[]> {
    const trimmed = text.trim()
    if (!trimmed) throw new Error('Message cannot be empty.')

    const apiKey = await this.settings.getDecryptedApiKey()
    if (!apiKey) throw new Error('No Anthropic API key configured. Add one in Settings first.')

    const dir = await requireProjectDir(projectId)
    const messages = await this.listMessages(projectId, context)

    const userMessage: AiMessage = {
      id: randomUUID(),
      role: 'user',
      content: trimmed,
      createdAt: new Date().toISOString(),
    }
    messages.push(userMessage)

    let replyText: string
    try {
      const client = new Anthropic({ apiKey })
      const response = await client.messages.create({
        model: AI_MODEL,
        max_tokens: MAX_RESPONSE_TOKENS,
        system: SYSTEM_PROMPTS[context],
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      })
      const textBlock = response.content.find((block) => block.type === 'text')
      replyText = textBlock && textBlock.type === 'text' ? textBlock.text : ''
      if (!replyText) replyText = '(No text in the response.)'
    } catch (err) {
      // Nothing has been written to disk yet at this point — a failed call leaves the
      // conversation file untouched rather than saving a question with no answer.
      throw new Error(describeError(err))
    }

    messages.push({
      id: randomUUID(),
      role: 'assistant',
      content: replyText,
      createdAt: new Date().toISOString(),
    })

    await writeJsonFile(conversationPath(dir, context), messages)
    await touchProject(dir)
    return messages
  }
}
