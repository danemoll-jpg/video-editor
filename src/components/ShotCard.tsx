import { useState } from 'react'
import type { Asset, Shot, ShotStatus } from '../api'
import { SHOT_STATUSES, SHOT_STATUS_LABELS } from '../../electron/shotStatus'

export interface ShotUpdates {
  title?: string
  description?: string
  promptText?: string
  status?: ShotStatus
  linkedAssetId?: string | null
}

interface Props {
  shot: Shot
  assets: Asset[]
  isFirst: boolean
  isLast: boolean
  onUpdate: (updates: ShotUpdates) => void
  onDelete: () => void
  onMove: (direction: 'up' | 'down') => void
}

export default function ShotCard({ shot, assets, isFirst, isLast, onUpdate, onDelete, onMove }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [title, setTitle] = useState(shot.title)
  const [description, setDescription] = useState(shot.description)
  const [promptText, setPromptText] = useState(shot.promptText)
  const [copied, setCopied] = useState(false)

  const dirty = title !== shot.title || description !== shot.description || promptText !== shot.promptText

  function handleSaveDetails() {
    onUpdate({ title, description, promptText })
  }

  async function handleCopyPrompt() {
    await navigator.clipboard.writeText(promptText)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const nextStatus = SHOT_STATUSES[SHOT_STATUSES.indexOf(shot.status) + 1]

  return (
    <div className="shot-card">
      <div className="shot-card__row">
        <button className="shot-card__collapse" onClick={() => setExpanded(!expanded)}>
          {expanded ? '▼' : '▶'}
        </button>
        <span className="shot-card__title">{shot.title}</span>
        <select
          className="shot-card__status"
          value={shot.status}
          onChange={(e) => onUpdate({ status: e.target.value as ShotStatus })}
        >
          {SHOT_STATUSES.map((status) => (
            <option key={status} value={status}>
              {SHOT_STATUS_LABELS[status]}
            </option>
          ))}
        </select>
        {nextStatus && (
          <button
            className="btn"
            title={`Advance to ${SHOT_STATUS_LABELS[nextStatus]}`}
            onClick={() => onUpdate({ status: nextStatus })}
          >
            {SHOT_STATUS_LABELS[nextStatus]} →
          </button>
        )}
        <div className="spacer" />
        <button className="btn" disabled={isFirst} onClick={() => onMove('up')} title="Move up">
          ↑
        </button>
        <button className="btn" disabled={isLast} onClick={() => onMove('down')} title="Move down">
          ↓
        </button>
        <button className="btn btn--danger" onClick={onDelete}>
          Delete
        </button>
      </div>

      {expanded && (
        <div className="shot-card__details">
          <label className="shot-card__field">
            Title
            <input value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="shot-card__field">
            Description
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="What happens in this shot"
            />
          </label>
          <label className="shot-card__field">
            AI prompt
            <textarea
              value={promptText}
              onChange={(e) => setPromptText(e.target.value)}
              rows={3}
              placeholder="Prompt to copy/paste into Grok, Suno, ElevenLabs, etc."
            />
          </label>
          <div className="shot-card__field-actions">
            <button className="btn btn--primary" disabled={!dirty} onClick={handleSaveDetails}>
              Save Details
            </button>
            <button className="btn" disabled={!promptText} onClick={handleCopyPrompt}>
              {copied ? 'Copied!' : 'Copy Prompt'}
            </button>
          </div>

          <label className="shot-card__field">
            Linked asset
            <select
              value={shot.linkedAssetId ?? ''}
              onChange={(e) => onUpdate({ linkedAssetId: e.target.value || null })}
            >
              <option value="">None</option>
              {assets.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.originalName}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
    </div>
  )
}
