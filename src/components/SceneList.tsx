import { useEffect, useState } from 'react'
import type { Asset, Scene, SfxEntry, Shot } from '../api'
import SceneCard, { type SceneUpdates } from './SceneCard'
import type { ShotUpdates } from './ShotCard'

interface Props {
  projectId: string
  assets: Asset[]
  /**
   * Called with a shot's linked (or newly created) Grok Prompt Lab entry id
   * once ready to navigate there. `armAutoInsert` is true only on a fresh
   * first-click draft (a brand-new entry, its draft request just placed
   * unsent into the AI Assistant composer) — see `handleDraftGrokPrompt`
   * below — so the landing panel knows to auto-insert the *next* AI reply
   * into this entry's prompt field instead of the normal manual-Insert
   * flow. A plain navigate to an already-linked entry passes `false`.
   */
  onOpenGrokEntry: (entryId: string, armAutoInsert: boolean) => void
}

export default function SceneList({ projectId, assets, onOpenGrokEntry }: Props) {
  const [scenes, setScenes] = useState<Scene[]>([])
  const [shots, setShots] = useState<Shot[]>([])
  const [sfxEntries, setSfxEntries] = useState<SfxEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [newSceneTitle, setNewSceneTitle] = useState('')
  const [addingScene, setAddingScene] = useState(false)
  const [draftingGrokPromptShotId, setDraftingGrokPromptShotId] = useState<string | null>(null)

  async function refresh() {
    setLoading(true)
    try {
      const [s, sh, sfx] = await Promise.all([
        window.api.listScenes(projectId),
        window.api.listShots(projectId),
        window.api.listSfxEntries(projectId),
      ])
      setScenes(s)
      setShots(sh)
      setSfxEntries(sfx)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  async function guard(action: () => Promise<void>) {
    try {
      await action()
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleAddScene() {
    if (!newSceneTitle.trim() || addingScene) return
    setAddingScene(true)
    await guard(async () => {
      setScenes(await window.api.createScene(projectId, newSceneTitle))
      setNewSceneTitle('')
    })
    setAddingScene(false)
  }

  function handleDeleteScene(sceneId: string) {
    if (!window.confirm('Delete this scene and all of its shots? This cannot be undone.')) return
    guard(async () => {
      const result = await window.api.deleteScene(projectId, sceneId)
      setScenes(result.scenes)
      setShots(result.shots)
    })
  }

  function handleMoveScene(sceneId: string, direction: 'up' | 'down') {
    guard(async () => setScenes(await window.api.moveScene(projectId, sceneId, direction)))
  }

  function handleUpdateScene(sceneId: string, updates: SceneUpdates) {
    guard(async () => setScenes(await window.api.updateScene(projectId, sceneId, updates)))
  }

  function handleAddShot(sceneId: string, title: string) {
    guard(async () => setShots(await window.api.createShot(projectId, sceneId, title)))
  }

  function handleUpdateShot(shotId: string, updates: ShotUpdates) {
    guard(async () => setShots(await window.api.updateShot(projectId, shotId, updates)))
  }

  function handleDeleteShot(shotId: string) {
    if (!window.confirm('Delete this shot?')) return
    guard(async () => setShots(await window.api.deleteShot(projectId, shotId)))
  }

  function handleMoveShot(shotId: string, direction: 'up' | 'down') {
    guard(async () => setShots(await window.api.moveShot(projectId, shotId, direction)))
  }

  /**
   * "✨ Draft Grok Prompt" (2026-09-14, revised again the same day per Dan's
   * request for a review step before anything hits the API). If the shot
   * already has a linked entry, just navigate — no duplicate, no re-draft.
   * Otherwise: create one Grok Prompt Lab entry (seeded from the shot's
   * title/description, which carries forward any script detail the outline
   * generator preserved verbatim, per this round's other fix) and link it
   * to the shot immediately, same as before — but instead of stopping
   * there, also assemble a fuller draft-request (the same seed, prefixed
   * with the project's Idea notes as style/rules context if any exist) and
   * place it, unsent, into the Grok AI Assistant's composer via
   * `saveAiDraft` — the same persistence `AiAssistantPanel` already reads
   * on expand, so it shows up there pre-filled with nothing more than a
   * normal navigate. No Anthropic call happens here; Dan reviews/edits and
   * sends it himself. `armAutoInsert: true` tells the landing panel to
   * auto-insert *that* send's reply into this entry's prompt field once it
   * comes back, instead of requiring a manual "Insert" click.
   */
  async function handleDraftGrokPrompt(shot: Shot) {
    if (draftingGrokPromptShotId) return
    setDraftingGrokPromptShotId(shot.id)
    await guard(async () => {
      let entryId = shot.linkedGrokEntryId
      let armAutoInsert = false
      if (!entryId) {
        const seed = [shot.title, shot.description].filter((s) => s.trim()).join('\n\n') || shot.title
        const entries = await window.api.createPromptEntry(projectId, 'grok', { promptText: seed })
        entryId = entries[0].id // listPromptEntries/createPromptEntry both return newest-first
        setShots(await window.api.updateShot(projectId, shot.id, { linkedGrokEntryId: entryId }))

        const idea = await window.api.getIdea(projectId)
        const draftRequest = idea.content.trim()
          ? `Project style/rules notes (from the Idea tab), for context:\n${idea.content.trim()}\n\n---\n\nDraft a Grok video-generation prompt for this shot:\n\n${seed}`
          : `Draft a Grok video-generation prompt for this shot:\n\n${seed}`
        await window.api.saveAiDraft(projectId, 'grok', draftRequest)
        armAutoInsert = true
      }
      onOpenGrokEntry(entryId, armAutoInsert)
    })
    setDraftingGrokPromptShotId(null)
  }

  if (loading) return <p className="muted">Loading scenes…</p>

  return (
    <div className="scene-list">
      {error && <div className="error-banner">{error}</div>}

      {scenes.length === 0 && (
        <p className="muted">
          No scenes yet. Break your script into scenes, then break each scene into shots to plan
          and track production.
        </p>
      )}

      {scenes.map((scene, index) => (
        <SceneCard
          key={scene.id}
          scene={scene}
          shots={shots.filter((s) => s.sceneId === scene.id)}
          assets={assets}
          sfxEntries={sfxEntries}
          isFirst={index === 0}
          isLast={index === scenes.length - 1}
          onUpdate={(updates) => handleUpdateScene(scene.id, updates)}
          onDelete={() => handleDeleteScene(scene.id)}
          onMove={(direction) => handleMoveScene(scene.id, direction)}
          onAddShot={(title) => handleAddShot(scene.id, title)}
          onUpdateShot={handleUpdateShot}
          onDeleteShot={handleDeleteShot}
          onMoveShot={handleMoveShot}
          onDraftGrokPrompt={handleDraftGrokPrompt}
          draftingGrokPromptShotId={draftingGrokPromptShotId}
        />
      ))}

      <div className="new-scene-form">
        <input
          type="text"
          placeholder="New scene title, e.g. Scene 1 — Forest Entrance"
          value={newSceneTitle}
          onChange={(e) => setNewSceneTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAddScene()}
        />
        <button className="btn btn--primary" disabled={addingScene} onClick={handleAddScene}>
          {addingScene ? 'Adding…' : '+ Add Scene'}
        </button>
      </div>
    </div>
  )
}
