import { useState } from 'react'
import type { Asset, Scene, SfxEntry, Shot } from '../api'
import ShotCard, { type ShotUpdates } from './ShotCard'

export interface SceneUpdates {
  title?: string
  description?: string
  linkedSongAssetIds?: string[]
}

interface Props {
  scene: Scene
  shots: Shot[]
  assets: Asset[]
  sfxEntries: SfxEntry[]
  isFirst: boolean
  isLast: boolean
  onUpdate: (updates: SceneUpdates) => void
  onDelete: () => void
  onMove: (direction: 'up' | 'down') => void
  onAddShot: (title: string) => void
  onUpdateShot: (shotId: string, updates: ShotUpdates) => void
  onDeleteShot: (shotId: string) => void
  onMoveShot: (shotId: string, direction: 'up' | 'down') => void
  onDraftGrokPrompt: (shot: Shot) => void
  draftingGrokPromptShotId: string | null
}

export default function SceneCard({
  scene,
  shots,
  assets,
  sfxEntries,
  isFirst,
  isLast,
  onUpdate,
  onDelete,
  onMove,
  onAddShot,
  onUpdateShot,
  onDeleteShot,
  onMoveShot,
  onDraftGrokPrompt,
  draftingGrokPromptShotId,
}: Props) {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(scene.title)
  const [description, setDescription] = useState(scene.description)
  const [collapsed, setCollapsed] = useState(false)
  const [newShotTitle, setNewShotTitle] = useState('')

  const audioAssets = assets.filter((a) => a.kind === 'audio')

  function toggleSong(assetId: string) {
    const current = scene.linkedSongAssetIds
    const next = current.includes(assetId) ? current.filter((id) => id !== assetId) : [...current, assetId]
    onUpdate({ linkedSongAssetIds: next })
  }

  function handleSaveEdit() {
    onUpdate({ title, description })
    setEditing(false)
  }

  function handleCancelEdit() {
    setTitle(scene.title)
    setDescription(scene.description)
    setEditing(false)
  }

  function handleAddShot() {
    if (!newShotTitle.trim()) return
    onAddShot(newShotTitle)
    setNewShotTitle('')
  }

  return (
    <section className="scene-card">
      <div className="scene-card__header">
        <button className="scene-card__collapse" onClick={() => setCollapsed(!collapsed)}>
          {collapsed ? '▶' : '▼'}
        </button>

        {editing ? (
          <div className="scene-card__edit-form">
            <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Scene description (optional)"
              rows={2}
            />
            <div className="scene-card__edit-actions">
              <button className="btn btn--primary" onClick={handleSaveEdit}>
                Save
              </button>
              <button className="btn" onClick={handleCancelEdit}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="scene-card__title-block" onClick={() => setCollapsed(!collapsed)}>
            <h3>{scene.title}</h3>
            {scene.description && <p className="muted scene-card__description">{scene.description}</p>}
          </div>
        )}

        <div className="spacer" />
        {!editing && (
          <div className="scene-card__actions">
            <button className="btn" disabled={isFirst} onClick={() => onMove('up')} title="Move up">
              ↑
            </button>
            <button className="btn" disabled={isLast} onClick={() => onMove('down')} title="Move down">
              ↓
            </button>
            <button className="btn" onClick={() => setEditing(true)}>
              Edit
            </button>
            <button className="btn btn--danger" onClick={onDelete}>
              Delete
            </button>
          </div>
        )}
      </div>

      {!collapsed && (
        <div className="scene-card__body">
          <div className="shot-card__field">
            Linked songs <span className="muted">(not capped at one)</span>
            {audioAssets.length === 0 ? (
              <p className="muted">No audio assets imported yet.</p>
            ) : (
              <div className="checkbox-list">
                {audioAssets.map((asset) => (
                  <label key={asset.id} className="checkbox-list__item">
                    <input
                      type="checkbox"
                      checked={scene.linkedSongAssetIds.includes(asset.id)}
                      onChange={() => toggleSong(asset.id)}
                    />
                    {asset.originalName}
                  </label>
                ))}
              </div>
            )}
          </div>

          {shots.length === 0 ? (
            <p className="muted">No shots yet.</p>
          ) : (
            shots.map((shot, index) => (
              <ShotCard
                key={shot.id}
                shot={shot}
                assets={assets}
                sfxEntries={sfxEntries}
                isFirst={index === 0}
                isLast={index === shots.length - 1}
                onUpdate={(updates) => onUpdateShot(shot.id, updates)}
                onDelete={() => onDeleteShot(shot.id)}
                onMove={(direction) => onMoveShot(shot.id, direction)}
                onDraftGrokPrompt={() => onDraftGrokPrompt(shot)}
                draftingGrokPrompt={draftingGrokPromptShotId === shot.id}
              />
            ))
          )}

          <div className="new-shot-form">
            <input
              type="text"
              placeholder="New shot title, e.g. Wide shot of the clearing"
              value={newShotTitle}
              onChange={(e) => setNewShotTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddShot()}
            />
            <button className="btn" onClick={handleAddShot}>
              + Add Shot
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
