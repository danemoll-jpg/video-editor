import { useEffect, useState } from 'react'
import type { Idea } from '../api'
import { formatDate } from '../format'
import { useAutosave } from '../useAutosave'
import AiAssistantPanel from './AiAssistantPanel'

interface Props {
  projectId: string
}

/**
 * Phase 4's Idea tab — freeform premise/plot notes, same simple pattern as
 * ScriptEditor. As of 2026-09-14, saves are debounced-automatic (see
 * `useAutosave`), not dependent on the Save button/Ctrl+S — both still work,
 * as an explicit "save right now" affordance, but neither is required
 * anymore to avoid losing an edit.
 */
export default function IdeaEditor({ projectId }: Props) {
  const [idea, setIdea] = useState<Idea | null>(null)
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    window.api
      .getIdea(projectId)
      .then((i) => {
        if (cancelled) return
        setIdea(i)
        setDraft(i.content)
        setError(null)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [projectId])

  const dirty = idea !== null && draft !== idea.content

  async function persist(content: string) {
    setSaving(true)
    try {
      setIdea(await window.api.saveIdea(projectId, content))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  // Debounced-automatic save, flushed immediately if this tab is switched
  // away from before the debounce fires — see useAutosave.ts's header.
  useAutosave(draft, dirty, persist)

  function handleSave() {
    persist(draft)
  }

  if (loading) return <p className="muted">Loading idea notes…</p>

  return (
    <div className="script-editor">
      <AiAssistantPanel
        projectId={projectId}
        context="idea"
        label="Idea Assistant"
        onInsert={(text) => setDraft((d) => (d ? `${d}\n\n${text}` : text))}
      />

      <div className="script-editor__toolbar">
        <span className="muted">
          {saving
            ? 'Saving…'
            : dirty
              ? 'Unsaved changes — saving automatically…'
              : idea?.updatedAt
                ? `Last saved ${formatDate(idea.updatedAt)}`
                : 'Not saved yet'}
        </span>
        <div className="spacer" />
        <button className="btn btn--primary" disabled={!dirty || saving} onClick={handleSave}>
          {saving ? 'Saving…' : 'Save Idea'}
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <textarea
        className="script-editor__textarea"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault()
            handleSave()
          }
        }}
        placeholder="Freeform notes — premise, plot, tone, references. Break it into a script once it takes shape."
        spellCheck
      />
    </div>
  )
}
