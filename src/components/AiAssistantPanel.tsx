import { useEffect, useRef, useState } from 'react'
import type { AiAssistantContext, AiMessage } from '../api'
import { useAutosave } from '../useAutosave'

interface Props {
  projectId: string
  context: AiAssistantContext
  label: string
  /** Called with an assistant reply's text when its "Insert" button is clicked. */
  onInsert: (text: string) => void
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
 * Anthropic. `onInsert` is how a reply gets into the current tab's field;
 * this component has no idea what that field is.
 *
 * Every *sent* message was always persisted immediately by
 * `aiAssistantManager.sendMessage` (main process), with no manual-save step
 * — that part was never the bug. As of 2026-09-14, the composer's
 * in-progress, not-yet-sent `draft` is now also debounced-autosaved (see
 * `useAutosave`), since that draft living only in this component's React
 * state — silently destroyed the instant this panel unmounts, e.g. by
 * switching tabs — was the real cause behind "lost a whole conversation."
 */
export default function AiAssistantPanel({ projectId, context, label, onInsert }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [messages, setMessages] = useState<AiMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Switching project or context invalidates whatever was loaded/expanded.
    setExpanded(false)
    setLoaded(false)
    setMessages([])
    setDraft('')
    setError(null)
  }, [projectId, context])

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
      setMessages(await window.api.sendAiMessage(projectId, context, text))
      setDraft('')
      // Clear the persisted draft right away rather than waiting for the
      // autosave debounce to notice `draft` went back to '' — the message
      // it held has now actually been sent (and persisted) for real.
      window.api.saveAiDraft(projectId, context, '').catch(() => {})
      setError(null)
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
