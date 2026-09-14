import { useEffect, useRef, useState } from 'react'
import type { AiAssistantContext, AiMessage } from '../api'
import { useAutosave } from '../useAutosave'

interface Props {
  projectId: string
  context: AiAssistantContext
  label: string
  /** Called with an assistant reply's text when its "Insert" button is clicked. */
  onInsert: (text: string) => void
  /**
   * Starts the panel expanded and focuses the composer, instead of the
   * normal collapsed-by-default state — used by the "✨ Draft Grok Prompt"
   * shot flow (2026-09-14) to land the user ready to iterate rather than
   * needing an extra click to expand. Only read as this component's
   * *initial* state (see the mount-time `useState`/`useEffect` below); it
   * doesn't force the panel open on every render, so the user can still
   * collapse it normally afterward.
   */
  autoOpen?: boolean
  /**
   * When provided, the reply to this panel's *first* successful send (after
   * mount) is passed here automatically instead of waiting for a manual
   * "Insert" click — the "✨ Draft Grok Prompt" flow's review-step design
   * (revised 2026-09-14): the drafted request sits unsent in the composer
   * (via the persisted draft, same as any other composer text) for Dan to
   * review/edit and send himself, but once he does and a real reply comes
   * back, that reply auto-inserts. Read only at mount time (see the
   * `useState` initializer below) and disarms itself after firing once, so
   * it never fires again for later sends in the same panel visit even
   * though the prop itself only changes when the caller re-renders.
   */
  onAutoInsert?: (text: string) => void
}

/**
 * Phase 4's AI Assistant chat panel — the same component is reused in the
 * Idea tab, the Script tab, and each Prompt Lab sub-tab; `context` picks
 * which conversation history and system prompt apply (see
 * electron/aiAssistantManager.ts). Starts collapsed and loads its history
 * lazily on first expand, so a project with several contexts doesn't fire
 * off history reads for panels nobody opened.
 *
 * Deliberately doesn't pull in anything from the rest of the project (the
 * script, other prompts, etc.) — only what's typed here is sent to
 * Anthropic. `onInsert` is how a reply gets into the current tab's field on
 * a manual click; `onAutoInsert` (2026-09-14) is the same idea but fired
 * automatically for one specific reply — see its own doc comment above.
 * This component has no idea what either callback's target field actually
 * is.
 *
 * Every *sent* message was always persisted immediately by
 * `aiAssistantManager.sendMessage` (main process), with no manual-save step
 * — that part was never the bug. As of 2026-09-14, the composer's
 * in-progress, not-yet-sent `draft` is now also debounced-autosaved (see
 * `useAutosave`), since that draft living only in this component's React
 * state — silently destroyed the instant this panel unmounts, e.g. by
 * switching tabs — was the real cause behind "lost a whole conversation."
 */
export default function AiAssistantPanel({ projectId, context, label, onInsert, autoOpen, onAutoInsert }: Props) {
  const [expanded, setExpanded] = useState(!!autoOpen)
  const [loaded, setLoaded] = useState(false)
  const [messages, setMessages] = useState<AiMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Armed only when this panel mounted with an `onAutoInsert` target — see
  // that prop's doc comment. Reset alongside everything else when the
  // project/context this panel is showing changes (below).
  const [awaitingAutoInsertReply, setAwaitingAutoInsertReply] = useState(!!onAutoInsert)
  const listRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    // Switching project or context invalidates whatever was loaded/expanded.
    setExpanded(!!autoOpen)
    setLoaded(false)
    setMessages([])
    setDraft('')
    setError(null)
    setAwaitingAutoInsertReply(!!onAutoInsert)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, context])

  // Focus the composer once, on mount, when this panel was asked to open
  // pre-expanded — by the time this effect runs the textarea already exists,
  // since `expanded` starts true from the initial state above.
  useEffect(() => {
    if (autoOpen) composerRef.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!expanded || loaded) return
    setLoading(true)
    Promise.all([window.api.listAiMessages(projectId, context), window.api.getAiDraft(projectId, context)])
      .then(([m, savedDraft]) => {
        setMessages(m)
        // Functional update: if the user somehow already typed something in
        // the brief window before this load resolved, don't clobber it.
        setDraft((current) => (current ? current : savedDraft))
        setLoaded(true)
        setError(null)
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false))
  }, [expanded, loaded, projectId, context])

  // Debounced-automatic draft save, flushed immediately if this panel is
  // unmounted (its tab switched away from) before the debounce fires — see
  // useAutosave.ts's header. Gated on `loaded` so this can't fire (and wipe
  // out a previously-saved draft with an empty string) before the persisted
  // draft above has actually been read back into `draft`.
  useAutosave(draft, loaded, (value) => {
    window.api.saveAiDraft(projectId, context, value).catch(() => {
      // Best-effort — a failed draft save isn't worth surfacing as an error
      // banner; the composer text itself is still right there on screen.
    })
  })

  useEffect(() => {
    if (expanded) listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [messages, expanded])

  async function handleSend() {
    const text = draft.trim()
    if (!text || sending) return
    setSending(true)
    try {
      const updated = await window.api.sendAiMessage(projectId, context, text)
      setMessages(updated)
      setDraft('')
      // Clear the persisted draft right away rather than waiting for the
      // autosave debounce to notice `draft` went back to '' — the message
      // it held has now actually been sent (and persisted) for real.
      window.api.saveAiDraft(projectId, context, '').catch(() => {})
      setError(null)
      // "✨ Draft Grok Prompt" review-step design (2026-09-14): if this
      // panel was armed with an auto-insert target, this send's reply is
      // that target's answer — hand it straight to `onAutoInsert` instead
      // of waiting for a manual "Insert" click, then disarm so later sends
      // in this same panel visit behave normally.
      if (awaitingAutoInsertReply && onAutoInsert) {
        const reply = [...updated].reverse().find((m) => m.role === 'assistant')
        if (reply) onAutoInsert(reply.content)
        setAwaitingAutoInsertReply(false)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="ai-assistant">
      <button className="btn ai-assistant__toggle" onClick={() => setExpanded((e) => !e)}>
        {expanded ? 'Hide AI Assistant' : `🤖 ${label}`}
      </button>

      {expanded && (
        <div className="ai-assistant__panel">
          {error && <div className="error-banner">{error}</div>}

          <div className="ai-assistant__messages" ref={listRef}>
            {loading ? (
              <p className="muted">Loading conversation…</p>
            ) : messages.length === 0 ? (
              <p className="muted">
                Ask a question to get started — nothing else from the project is sent automatically.
              </p>
            ) : (
              messages.map((m) => (
                <div key={m.id} className={`ai-message ai-message--${m.role}`}>
                  <div className="ai-message__role">{m.role === 'user' ? 'You' : 'Claude'}</div>
                  <div className="ai-message__text">{m.content}</div>
                  {m.role === 'assistant' && (
                    <button className="btn ai-message__insert" onClick={() => onInsert(m.content)}>
                      Insert
                    </button>
                  )}
                </div>
              ))
            )}
          </div>

          <div className="ai-assistant__composer">
            <textarea
              ref={composerRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                  e.preventDefault()
                  handleSend()
                }
              }}
              rows={2}
              placeholder="Ask the AI Assistant… (Ctrl/Cmd+Enter to send)"
              disabled={sending}
            />
            <button className="btn btn--primary" disabled={!draft.trim() || sending} onClick={handleSend}>
              {sending ? 'Sending…' : 'Send'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
