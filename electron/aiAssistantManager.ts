import Anthropic from '@anthropic-ai/sdk'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { readJsonFile, writeJsonFile } from './fsUtils'
import { requireProjectDir, touchProject } from './projectPaths'
import type { SettingsManager } from './settingsManager'
import type { PromptLabKind } from './promptLabTypes'
import type { GeneratedSceneOutline } from './productionManager'

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
// Each context also gets a `<context>.draft.json` sibling file (added
// 2026-09-14) holding the composer's in-progress, not-yet-sent text — see
// `draftPath`'s comment below for why that exists as its own file rather
// than a field on the conversation array.
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

/**
 * System prompt for the "Generate Scenes & Shots" action (Script tab, added
 * 2026-09-14) — a one-shot structured-generation call, not a chat turn, so
 * it deliberately doesn't go through `sendMessage`/`SYSTEM_PROMPTS` above:
 * nothing here gets saved to any `aiAssistant/<context>.json` conversation
 * file, since it isn't a conversation. The prompt asks for strict JSON so
 * `parseGeneratedOutline` below can turn it directly into
 * `GeneratedSceneOutline[]` for `ProductionManager.applyGeneratedOutline`.
 *
 * 2026-09-14, updated per Dan's real use: his script format is already
 * shot-structured and detail-rich — e.g.
 * `**S17 | 0:55-0:58 | FULL** \u{1F3B5} "Making distance disappear." Wide of
 * the shared couch. Abi is very slightly translucent... *Motion: static,
 * gentle.* **COMP NOTE:** Abi layer at 88% opacity, feathered edge.` — and
 * the original prompt above (still describing the general task) said nothing
 * about that detail, so the model paraphrased it away into a generic
 * description instead of carrying it forward. The block below is additive:
 * it explicitly calls out the categories of detail Dan's format actually
 * contains (timestamps, quoted/music-marked lyric lines, shot/scene codes,
 * labeled notes) and instructs preserving them verbatim inside the
 * generated shot's description, rather than summarizing over them — a shot
 * built from that example should keep "0:55-0:58", the exact quoted lyric,
 * "COMP NOTE: Abi layer at 88% opacity, feathered edge," and "Motion:
 * static, gentle" recognizably intact in its description text, not
 * paraphrased into something like "a couple sits on a couch."
 */
// Exported (like parseGeneratedOutline below) purely so a scripted
// verification pass can assert its actual content — e.g. that Dan's real
// example is present and the verbatim-preservation instructions are there —
// without needing a real, paid Anthropic call just to check prompt text.
export const SCENE_OUTLINE_SYSTEM_PROMPT = `You are helping a solo creator turn a finished script for a short-form video into a first-pass production breakdown: scenes, and a shot breakdown within each scene.

Read the script text the user provides and respond with ONLY a JSON array — no prose, no markdown code fences, nothing before or after it — matching exactly this shape:

[
  {
    "title": "short scene title",
    "description": "1-3 sentences describing what happens in this scene",
    "shots": [
      { "title": "short shot title", "description": "1-2 sentences describing what this shot shows" }
    ]
  }
]

Break the script into a sensible number of scenes, in script order, and break each scene into a sensible first-pass shot list (typically a few shots per scene, however many the scene's content actually calls for — a short scene might only need one). Titles and descriptions only: do not write video-generation prompts, camera-move jargon, or any field beyond title/description — that level of detail belongs to a separate, later step.

IMPORTANT — preserve structured script detail verbatim, do not summarize it away. Some scripts are already written in a shot-structured shorthand with precise, load-bearing detail inline, for example:

**S17 | 0:55-0:58 | FULL** \u{1F3B5} "Making distance disappear." Wide of the shared couch. Abi is very slightly translucent... *Motion: static, gentle.* **COMP NOTE:** Abi layer at 88% opacity, feathered edge.

Whenever the script text contains any of the following, copy it into the relevant shot's "description" field exactly as written (verbatim, not reworded or paraphrased) rather than replacing it with a generic summary:
- Timestamps or time ranges (e.g. "0:55-0:58")
- Quoted or music-marked lyric lines (e.g. \u{1F3B5} "Making distance disappear.")
- Explicit shot or scene codes (e.g. "S17", "FULL")
- Clearly-marked notes, such as anything labeled "COMP NOTE:", "Motion:", or similar all-caps/colon-prefixed labels

A generic paraphrase like "a couple sits on a couch" is wrong if the source text actually specifies the shot code, timing, quoted lyric, motion note, and comp note above — all of that detail must still be recognizable in the generated description, folded in alongside your own plain-language summary of the action, not dropped in favor of it. If a shot in the script has none of this structured detail, just describe it normally.

Respond with the JSON array and nothing else.`

/**
 * Turns a raw model response into validated GeneratedSceneOutline[], or
 * throws a clear error. Exported (unlike this file's other private helpers)
 * so a scripted verification pass can exercise the real parsing logic
 * directly against hand-written model-response fixtures, without spending
 * real money on an actual Anthropic call just to test JSON handling.
 */
export function parseGeneratedOutline(raw: string): GeneratedSceneOutline[] {
  // Strip a markdown code fence if the model wrapped its JSON in one despite being asked not to.
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim()

  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    throw new Error("The AI's response wasn't valid JSON — try generating again.")
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('The AI did not return any scenes — try generating again.')
  }

  return parsed.map((item, i) => {
    if (typeof item !== 'object' || item === null) {
      throw new Error(`Scene ${i + 1} in the AI's response was malformed — try generating again.`)
    }
    const scene = item as Record<string, unknown>
    const rawShots = Array.isArray(scene.shots) ? scene.shots : []
    return {
      title: typeof scene.title === 'string' ? scene.title : '',
      description: typeof scene.description === 'string' ? scene.description : '',
      shots: rawShots.map((s) => {
        const shot = (typeof s === 'object' && s !== null ? s : {}) as Record<string, unknown>
        return {
          title: typeof shot.title === 'string' ? shot.title : '',
          description: typeof shot.description === 'string' ? shot.description : '',
        }
      }),
    }
  })
}

function conversationPath(dir: string, context: AiAssistantContext): string {
  return path.join(dir, 'aiAssistant', `${context}.json`)
}

/**
 * The composer's in-progress, not-yet-sent draft — a sibling file to the
 * conversation itself so the existing `AiMessage[]` shape on disk doesn't
 * need to change. See "URGENT, PRIORITY (2026-09-14)" in TODO.md: an
 * already-*sent* message was always persisted immediately (this file's
 * `sendMessage` writes before returning, with no manual-save step), but a
 * message the user was still typing lived only in the renderer's React
 * state — switching tabs unmounts the panel and silently discards it. This
 * is the real root cause behind the "lost a whole conversation" report; the
 * fix is persisting the draft the same debounced-autosave way as Idea/
 * Script notes (see `src/useAutosave.ts`), not touching the already-solid
 * sent-message path.
 */
function draftPath(dir: string, context: AiAssistantContext): string {
  return path.join(dir, 'aiAssistant', `${context}.draft.json`)
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

  /** The composer's persisted draft, if any — see `draftPath`'s comment above. */
  async getDraft(projectId: string, context: AiAssistantContext): Promise<string> {
    const dir = await requireProjectDir(projectId)
    const data = await readJsonFile<{ text: string }>(draftPath(dir, context), { text: '' })
    return data.text
  }

  /**
   * Called debounced, on every composer keystroke, and flushed immediately on
   * unmount (tab switch) by the renderer's `useAutosave` hook — not a manual
   * save. Deliberately doesn't `touchProject`: an in-progress, unsent draft
   * isn't saved project content, so it shouldn't bump "last updated."
   */
  async saveDraft(projectId: string, context: AiAssistantContext, text: string): Promise<void> {
    const dir = await requireProjectDir(projectId)
    await writeJsonFile(draftPath(dir, context), { text })
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

  /**
   * The "Generate Scenes & Shots" action (Script tab): sends the project's
   * script text as a one-shot structured-generation request (not a saved
   * chat turn — see `SCENE_OUTLINE_SYSTEM_PROMPT`'s comment above) and
   * returns the parsed outline. This method only calls the API and parses
   * the result — it writes nothing to the project itself; the caller (the
   * renderer's Generate dialog, via `ProductionManager.applyGeneratedOutline`)
   * decides whether to add or replace, since only it knows whether the
   * project already has scenes and what the user chose to do about that.
   */
  async generateSceneOutline(projectId: string, scriptText: string): Promise<GeneratedSceneOutline[]> {
    const trimmed = scriptText.trim()
    if (!trimmed) throw new Error('Write a script first — there is nothing to generate scenes from.')

    const apiKey = await this.settings.getDecryptedApiKey()
    if (!apiKey) throw new Error('No Anthropic API key configured. Add one in Settings first.')

    // Validates the project exists; this call itself writes nothing to disk.
    await requireProjectDir(projectId)

    let raw: string
    try {
      const client = new Anthropic({ apiKey })
      const response = await client.messages.create({
        model: AI_MODEL,
        max_tokens: 8192,
        system: SCENE_OUTLINE_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: trimmed }],
      })
      const textBlock = response.content.find((block) => block.type === 'text')
      raw = textBlock && textBlock.type === 'text' ? textBlock.text : ''
    } catch (err) {
      throw new Error(describeError(err))
    }

    return parseGeneratedOutline(raw)
  }
}
