import { useEffect, useState } from 'react'
import type { Script } from '../api'
import { formatDate } from '../format'
import { useAutosave } from '../useAutosave'
import AiAssistantPanel from './AiAssistantPanel'
import GenerateOutlineDialog from './GenerateOutlineDialog'

interface Props {
  projectId: string
}

/**
 * As of 2026-09-14, saves are debounced-automatic (see `useAutosave`), not
 * dependent on the Save button/Ctrl+S — both still work, as an explicit
 * "save right now" affordance, but neither is required anymore to avoid
 * losing an edit. See IdeaEditor.tsx, which shares this exact pattern.
 */
export default function ScriptEditor({ projectId }: Props) {
  const [script, setScript] = useState<Script | null>(null)
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showGenerateDialog, setShowGenerateDialog] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    window.api
      .getScript(projectId)
      .then((s) => {
        if (cancelled) return
        setScript(s)
        setDraft(s.content)
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

  const dirty = script !== null && draft !== script.content

  async function persist(content: string) {
    setSaving(true)
    try {
      setScript(await window.api.saveScript(projectId, content))
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

  if (loading) return <p className="muted">Loading script…</p>

  return (
    <div className="script-editor">
      <AiAssistantPanel
        projectId={projectId}
        context="script"
        label="Script Assistant"
        onInsert={(text) => setDraft((d) => (d ? `${d}\n\n${text}` : text))}
      />

      <div className="script-editor__toolbar">
        <span className="muted">
          {saving
            ? 'Saving…'
            : dirty
              ? 'Unsaved changes — saving automatically…'
              : script?.updatedAt
                ? `Last saved ${formatDate(script.updatedAt)}`
                : 'Not saved yet'}
        </span>
        <div className="spacer" />
        <button className="btn" disabled={!draft.trim()} onClick={() => setShowGenerateDialog(true)}>
          ✨ Generate Scenes & Shots
        </button>
        <button className="btn btn--primary" disabled={!dirty || saving} onClick={handleSave}>
          {saving ? 'Saving…' : 'Save Script'}
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {showGenerateDialog && (
        <GenerateOutlineDialog
          projectId={projectId}
          scriptText={draft}
          onClose={() => setShowGenerateDialog(false)}
        />
      )}

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
        placeholder="Write your script here — freeform text or markdown. Break it into scenes and shots in the Scenes & Shots tab."
        spellCheck
      />
    </div>
  )
}
