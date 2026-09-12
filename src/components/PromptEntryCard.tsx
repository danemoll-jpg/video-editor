import { useState } from 'react'
import type { Asset, PromptEntry, PromptEntryUpdates, RatingInput } from '../api'
import type { RatingDimension } from '../../electron/promptLabTypes'
import { formatDate } from '../format'
import { averageScores } from '../ratingUtils'
import StarRating from './StarRating'

interface Props {
  entry: PromptEntry
  dimensions: RatingDimension[]
  showLyrics: boolean
  assets: Asset[]
  parentEntry: PromptEntry | undefined
  compareSelected: boolean
  compareDisabled: boolean
  onToggleCompare: () => void
  onUpdate: (updates: PromptEntryUpdates) => void
  onDelete: () => void
  onAddRating: (input: RatingInput) => void
  onDeleteRating: (ratingId: string) => void
  onPromote: (name: string) => void
  onNewVersion: () => void
}

function emptyScores(dimensions: RatingDimension[]): Record<string, number> {
  return Object.fromEntries(dimensions.map((d) => [d.key, 0]))
}

export default function PromptEntryCard({
  entry,
  dimensions,
  showLyrics,
  assets,
  parentEntry,
  compareSelected,
  compareDisabled,
  onToggleCompare,
  onUpdate,
  onDelete,
  onAddRating,
  onDeleteRating,
  onPromote,
  onNewVersion,
}: Props) {
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [promptText, setPromptText] = useState(entry.promptText)
  const [lyrics, setLyrics] = useState(entry.lyrics)
  const [settings, setSettings] = useState(entry.settings)
  const [notes, setNotes] = useState(entry.notes)
  const [tagsText, setTagsText] = useState(entry.tags.join(', '))
  const [copied, setCopied] = useState(false)
  const [addingRating, setAddingRating] = useState(false)
  const [clipLabel, setClipLabel] = useState('')
  const [ratingAssetId, setRatingAssetId] = useState('')
  const [ratingNotes, setRatingNotes] = useState('')
  const [scores, setScores] = useState<Record<string, number>>(() => emptyScores(dimensions))
  const [promoting, setPromoting] = useState(false)
  const [recipeName, setRecipeName] = useState('')

  const { overall } = averageScores(entry.ratings, dimensions.map((d) => d.key))

  function handleSaveEdit() {
    onUpdate({
      promptText,
      lyrics,
      settings,
      notes,
      tags: tagsText
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
    })
    setEditing(false)
  }

  function handleCancelEdit() {
    setPromptText(entry.promptText)
    setLyrics(entry.lyrics)
    setSettings(entry.settings)
    setNotes(entry.notes)
    setTagsText(entry.tags.join(', '))
    setEditing(false)
  }

  async function handleCopyPrompt() {
    await navigator.clipboard.writeText(entry.promptText)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  function handleSubmitRating() {
    if (!clipLabel.trim()) return
    onAddRating({
      clipLabel,
      linkedAssetId: ratingAssetId || null,
      scores,
      notes: ratingNotes,
    })
    setClipLabel('')
    setRatingAssetId('')
    setRatingNotes('')
    setScores(emptyScores(dimensions))
    setAddingRating(false)
  }

  function handleSubmitPromote() {
    if (!recipeName.trim()) return
    onPromote(recipeName)
    setRecipeName('')
    setPromoting(false)
  }

  return (
    <div className="prompt-entry-card">
      <div className="prompt-entry-card__row">
        <input
          type="checkbox"
          title="Select for version comparison"
          checked={compareSelected}
          disabled={!compareSelected && compareDisabled}
          onChange={onToggleCompare}
        />
        <button className="shot-card__collapse" onClick={() => setExpanded(!expanded)}>
          {expanded ? '▼' : '▶'}
        </button>
        <div className="prompt-entry-card__summary" onClick={() => setExpanded(!expanded)}>
          <span className="prompt-entry-card__prompt-preview">{entry.promptText}</span>
          <span className="muted prompt-entry-card__meta">
            {formatDate(entry.createdAt)}
            {parentEntry && ' · versioned from an earlier entry'}
            {entry.ratings.length > 0 &&
              ` · ${entry.ratings.length} clip${entry.ratings.length === 1 ? '' : 's'} rated`}
          </span>
        </div>
        {overall !== null && (
          <span className="prompt-entry-card__avg" title="Average across all rated clips">
            <StarRating value={Math.round(overall)} size="sm" /> <span className="muted">{overall.toFixed(1)}</span>
          </span>
        )}
        <div className="spacer" />
        {entry.tags.length > 0 && (
          <span className="tag-list">
            {entry.tags.map((t) => (
              <span key={t} className="tag">
                {t}
              </span>
            ))}
          </span>
        )}
      </div>

      {expanded && (
        <div className="prompt-entry-card__details">
          {editing ? (
            <div className="prompt-entry-card__edit-form">
              <label className="shot-card__field">
                Prompt
                <textarea value={promptText} onChange={(e) => setPromptText(e.target.value)} rows={3} />
              </label>
              {showLyrics && (
                <label className="shot-card__field">
                  Lyrics
                  <textarea value={lyrics} onChange={(e) => setLyrics(e.target.value)} rows={4} />
                </label>
              )}
              <label className="shot-card__field">
                Settings
                <textarea
                  value={settings}
                  onChange={(e) => setSettings(e.target.value)}
                  rows={2}
                  placeholder="Model/voice/style params, e.g. instrumental off, style influence 60%"
                />
              </label>
              <label className="shot-card__field">
                Notes
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
              </label>
              <label className="shot-card__field">
                Tags (comma-separated)
                <input value={tagsText} onChange={(e) => setTagsText(e.target.value)} />
              </label>
              <div className="shot-card__field-actions">
                <button className="btn btn--primary" onClick={handleSaveEdit}>
                  Save
                </button>
                <button className="btn" onClick={handleCancelEdit}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="prompt-entry-card__field-block">
                <div className="muted field-label">Prompt</div>
                <p className="prompt-entry-card__text">{entry.promptText}</p>
              </div>
              {showLyrics && entry.lyrics && (
                <div className="prompt-entry-card__field-block">
                  <div className="muted field-label">Lyrics</div>
                  <p className="prompt-entry-card__text">{entry.lyrics}</p>
                </div>
              )}
              {entry.settings && (
                <div className="prompt-entry-card__field-block">
                  <div className="muted field-label">Settings</div>
                  <p className="prompt-entry-card__text">{entry.settings}</p>
                </div>
              )}
              {entry.notes && (
                <div className="prompt-entry-card__field-block">
                  <div className="muted field-label">Notes</div>
                  <p className="prompt-entry-card__text">{entry.notes}</p>
                </div>
              )}
            </>
          )}

          {!editing && (
            <div className="prompt-entry-card__actions">
              <button className="btn" onClick={handleCopyPrompt}>
                {copied ? 'Copied!' : 'Copy Prompt'}
              </button>
              <button className="btn" onClick={onNewVersion}>
                New Version From This
              </button>
              <button className="btn" onClick={() => setEditing(true)}>
                Edit
              </button>
              <button className="btn" onClick={() => setPromoting(!promoting)}>
                Promote to Recipe
              </button>
              <button className="btn btn--danger" onClick={onDelete}>
                Delete
              </button>
            </div>
          )}

          {promoting && (
            <div className="inline-form">
              <input
                placeholder="Recipe name, e.g. Reliable close-up dialogue shot"
                value={recipeName}
                onChange={(e) => setRecipeName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSubmitPromote()}
                autoFocus
              />
              <button className="btn btn--primary" onClick={handleSubmitPromote}>
                Save Recipe
              </button>
              <button className="btn" onClick={() => setPromoting(false)}>
                Cancel
              </button>
            </div>
          )}

          <div className="prompt-entry-card__ratings">
            <div className="prompt-entry-card__ratings-header">
              <h4>Ratings</h4>
              <button className="btn" onClick={() => setAddingRating(!addingRating)}>
                {addingRating ? 'Cancel' : '+ Rate a Clip'}
              </button>
            </div>

            {entry.ratings.length === 0 && !addingRating && (
              <p className="muted">No clips rated yet.</p>
            )}

            {entry.ratings.map((rating) => (
              <div key={rating.id} className="rating-row">
                <div className="rating-row__header">
                  <span className="rating-row__label">{rating.clipLabel}</span>
                  {rating.linkedAssetId && (
                    <span className="muted">
                      {assets.find((a) => a.id === rating.linkedAssetId)?.originalName ?? 'linked asset'}
                    </span>
                  )}
                  <div className="spacer" />
                  <button className="asset-card__delete" title="Delete rating" onClick={() => onDeleteRating(rating.id)}>
                    ×
                  </button>
                </div>
                <div className="rating-row__scores">
                  {dimensions.map((d) => (
                    <div key={d.key} className="rating-row__score">
                      <span className="muted">{d.label}</span>
                      <StarRating value={rating.scores[d.key] ?? 0} size="sm" />
                    </div>
                  ))}
                </div>
                {rating.notes && <p className="muted rating-row__notes">{rating.notes}</p>}
              </div>
            ))}

            {addingRating && (
              <div className="inline-form inline-form--column">
                <input
                  placeholder="Clip label, e.g. Take 3 / v2-clip-A"
                  value={clipLabel}
                  onChange={(e) => setClipLabel(e.target.value)}
                  autoFocus
                />
                <div className="rating-row__scores">
                  {dimensions.map((d) => (
                    <div key={d.key} className="rating-row__score">
                      <span className="muted">{d.label}</span>
                      <StarRating
                        value={scores[d.key] ?? 0}
                        onChange={(v) => setScores((s) => ({ ...s, [d.key]: v }))}
                      />
                    </div>
                  ))}
                </div>
                <select value={ratingAssetId} onChange={(e) => setRatingAssetId(e.target.value)}>
                  <option value="">No linked asset</option>
                  {assets.map((asset) => (
                    <option key={asset.id} value={asset.id}>
                      {asset.originalName}
                    </option>
                  ))}
                </select>
                <textarea
                  placeholder="Notes on this clip (optional)"
                  value={ratingNotes}
                  onChange={(e) => setRatingNotes(e.target.value)}
                  rows={2}
                />
                <div className="shot-card__field-actions">
                  <button className="btn btn--primary" disabled={!clipLabel.trim()} onClick={handleSubmitRating}>
                    Save Rating
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
