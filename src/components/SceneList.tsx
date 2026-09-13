import { useEffect, useState } from 'react'
import type { Asset, Scene, SfxEntry, Shot } from '../api'
import SceneCard, { type SceneUpdates } from './SceneCard'
import type { ShotUpdates } from './ShotCard'

interface Props {
  projectId: string
  assets: Asset[]
}

export default function SceneList({ projectId, assets }: Props) {
  const [scenes, setScenes] = useState<Scene[]>([])
  const [shots, setShots] = useState<Shot[]>([])
  const [sfxEntries, setSfxEntries] = useState<SfxEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [newSceneTitle, setNewSceneTitle] = useState('')
  const [addingScene, setAddingScene] = useState(false)

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
