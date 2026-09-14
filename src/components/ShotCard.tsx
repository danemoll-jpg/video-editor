import { useState } from 'react'
import type { Asset, Shot, ShotStatus, SfxEntry } from '../api'
import { SHOT_STATUSES, SHOT_STATUS_LABELS } from '../../electron/shotStatus'

export interface ShotUpdates {
  title?: string
  description?: string
  promptText?: string
  status?: ShotStatus
  linkedAssetId?: string | null
  linkedSfxIds?: string[]
  linkedGrokEntryId?: string | null
}

interface Props {
  shot: Shot
  assets: Asset[]
  sfxEntries: SfxEntry[]
  isFirst: boolean
  isLast: boolean
  onUpdate: (updates: ShotUpdates) => void
  onDelete: () => void
  onMove: (direction: 'up' | 'down') => void
  /**
   * "✨ Draft Grok Prompt" (2026-09-14): if the shot has no linked Grok
   * Prompt Lab entry yet, create one (seeded from this shot's title/
   * description), link it, and navigate to Prompt Lab → Grok with it open;
   * if already linked, just navigate there — no duplicate. The actual
   * create-and-link work happens up in `SceneList` (which owns `shots` and
   * has `window.api`), not here — this component only triggers it and
   * shows a busy state while it's in flight.
   */
  onDraftGrokPrompt: () => void
  draftingGrokPrompt: boolean
}

export default function ShotCard({
  shot,
  assets,
  sfxEntries,
  isFirst,
  isLast,
  onUpdate,
  onDelete,
  onMove,
  onDraftGrokPrompt,
  draftingGrokPrompt,
}: Props) {
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

  function toggleSfx(sfxId: string) {
    const current = shot.linkedSfxIds
    const next = current.includes(sfxId) ? current.filter((id) => id !== sfxId) : [...current, sfxId]
    onUpdate({ linkedSfxIds: next })
  }

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
        <button
          className="btn"
          disabled={draftingGrokPrompt}
          title={
            shot.linkedGrokEntryId
              ? "Open this shot's linked Grok Prompt Lab entry"
              : 'Create a Grok Prompt Lab entry for this shot, seeded from its title/description, and open it with AI help'
          }
          onClick={onDraftGrokPrompt}
        >
          {draftingGrokPrompt ? 'Opening…' : shot.linkedGrokEntryId ? '✨ Open Grok Prompt' : '✨ Draft Grok Prompt'}
        </button>
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
            Linked asset <span className="muted">(the shot's primary generated clip)</span>
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

          <div className="shot-card__field">
            Linked SFX <span className="muted">(not capped at one)</span>
            {sfxEntries.length === 0 ? (
              <p className="muted">No SFX yet — add some in the Prompt Lab's SFX tab.</p>
            ) : (
              <div className="checkbox-list">
                {sfxEntries.map((sfx) => (
                  <label key={sfx.id} className="checkbox-list__item">
                    <input
                      type="checkbox"
                      checked={shot.linkedSfxIds.includes(sfx.id)}
                      onChange={() => toggleSfx(sfx.id)}
                    />
                    {sfx.name}
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
