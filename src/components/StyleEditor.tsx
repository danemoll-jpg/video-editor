import { useEffect, useState } from 'react'
import type { Style } from '../api'
import { formatDate } from '../format'
import { useAutosave } from '../useAutosave'
import AiAssistantPanel from './AiAssistantPanel'

interface Props {
  projectId: string
}

/**
 * The Style tab (2026-09-14, Phase 8's foundation) — same pattern as
 * IdeaEditor/ScriptEditor exactly: freeform text, debounced autosave (see
 * useAutosave.ts), an embedded AI Assistant. Holds cross-cutting visual/
 * tonal rules ("camera stays locked unless it's an emotional beat," "Abi is
 * always slightly translucent") that need to be reasserted at every
 * generation step, unlike Idea notes — see productionManager.ts's header
 * comment for the full Style-vs-Idea rationale. As of this tab's addition,
 * Style notes (not Idea notes) are what gets pulled into Grok/Suno/SFX
 * prompt-drafting context (src/components/SceneList.tsx) and into the
 * scene/shot outline generator (electron/aiAssistantManager.ts's
 * `generateSceneOutline`) — Idea notes are purely brainstorming now, fed
 * into no generation step.
 */
export default function StyleEditor({ projectId }: Props) {
  const [style, setStyle] = useState<Style | null>(null)
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    window.api
      .getStyle(projectId)
      .then((s) => {
        if (cancelled) return
        setStyle(s)
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

  const dirty = style !== null && draft !== style.content

  async function persist(content: string) {
    setSaving(true)
    try {
      setStyle(await window.api.saveStyle(projectId, content))
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

  if (loading) return <p className="muted">Loading style notes…</p>

  return (
    <div className="script-editor">
      <AiAssistantPanel
        projectId={projectId}
        context="style"
        label="Style Assistant"
        onInsert={(text) => setDraft((d) => (d ? `${d}\n\n${text}` : text))}
      />

      <div className="script-editor__toolbar">
        <span className="muted">
          {saving
            ? 'Saving…'
            : dirty
              ? 'Unsaved changes — saving automatically…'
              : style?.updatedAt
                ? `Last saved ${formatDate(style.updatedAt)}`
                : 'Not saved yet'}
        </span>
        <div className="spacer" />
        <button className="btn btn--primary" disabled={!dirty || saving} onClick={handleSave}>
          {saving ? 'Saving…' : 'Save Style'}
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
        placeholder="Cross-cutting visual/tonal rules — camera behavior, recurring motifs, color/lighting mood, character-treatment conventions. Reasserted at every AI prompt-drafting step and in the scene/shot outline generator, unlike Idea notes."
        spellCheck
      />
    </div>
  )
}
