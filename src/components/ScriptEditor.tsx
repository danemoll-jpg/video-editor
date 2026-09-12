import { useEffect, useState } from 'react'
import type { Script } from '../api'
import { formatDate } from '../format'

interface Props {
  projectId: string
}

export default function ScriptEditor({ projectId }: Props) {
  const [script, setScript] = useState<Script | null>(null)
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

  async function handleSave() {
    setSaving(true)
    try {
      setScript(await window.api.saveScript(projectId, draft))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <p className="muted">Loading script…</p>

  return (
    <div className="script-editor">
      <div className="script-editor__toolbar">
        <span className="muted">
          {script?.updatedAt ? `Last saved ${formatDate(script.updatedAt)}` : 'Not saved yet'}
        </span>
        <div className="spacer" />
        <button className="btn btn--primary" disabled={!dirty || saving} onClick={handleSave}>
          {saving ? 'Saving…' : 'Save Script'}
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
        placeholder="Write your script here — freeform text or markdown. Break it into scenes and shots in the Scenes & Shots tab."
        spellCheck
      />
    </div>
  )
}
