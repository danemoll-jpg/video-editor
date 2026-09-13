import { useState } from 'react'
import type { Asset, SfxEntry, SfxEntryUpdates, SfxRatingInput } from '../api'
import { SFX_RATING_DIMENSIONS, SFX_SOURCE_LABELS, SFX_PROMPT_PLACEHOLDER, type SfxSource } from '../../electron/sfxTypes'
import { formatDate } from '../format'
import { averageScores } from '../ratingUtils'
import StarRating from './StarRating'

interface Props {
  entry: SfxEntry
  assets: Asset[]
  parentEntry: SfxEntry | undefined
  compareSelected: boolean
  compareDisabled: boolean
  onToggleCompare: () => void
  onUpdate: (updates: SfxEntryUpdates) => void
  onDelete: () => void
  onAddRating: (input: SfxRatingInput) => void
  onDeleteRating: (ratingId: string) => void
  onPromote: (name: string) => void
  onNewVersion: () => void
}

function emptyScores(): Record<string, number> {
  return Object.fromEntries(SFX_RATING_DIMENSIONS.map((d) => [d.key, 0]))
}

/** One entry in the unified SFX system — a free/licensed download or an ElevenLabs generation, both with the same prompt/version/rating/recipe shape (see electron/sfxLibraryManager.ts). Mirrors PromptEntryCard's structure. */
export default function SfxEntryCard({
  entry,
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
  const [source, setSource] = useState<SfxSource>(entry.source)
  const [name, setName] = useState(entry.name)
  const [promptText, setPromptText] = useState(entry.promptText)
  const [tagsText, setTagsText] = useState(entry.tags.join(', '))
  const [sourceUrl, setSourceUrl] = useState(entry.sourceUrl)
  const [license, setLicense] = useState(entry.license)
  const [attribution, setAttribution] = useState(entry.attribution)
  const [settings, setSettings] = useState(entry.settings)
  const [notes, setNotes] = useState(entry.notes)
  const [linkedAssetId, setLinkedAssetId] = useState(entry.linkedAssetId ?? '')
  const [copied, setCopied] = useState(false)
  const [addingRating, setAddingRating] = useState(false)
  const [clipLabel, setClipLabel] = useState('')
  const [ratingAssetId, setRatingAssetId] = useState('')
  const [ratingNotes, setRatingNotes] = useState('')
  const [scores, setScores] = useState<Record<string, number>>(emptyScores)
  const [promoting, setPromoting] = useState(false)
  const [recipeName, setRecipeName] = useState('')

  const { overall } = averageScores(entry.ratings, SFX_RATING_DIMENSIONS.map((d) => d.key))

  function handleSaveEdit() {
    onUpdate({
      source,
      name,
      promptText,
      tags: tagsText
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      sourceUrl,
      license,
      attribution,
      settings,
      notes,
      linkedAssetId: linkedAssetId || null,
    })
    setEditing(false)
  }

  function handleCancelEdit() {
    setSource(entry.source)
    setName(entry.name)
    setPromptText(entry.promptText)
    setTagsText(entry.tags.join(', '))
    setSourceUrl(entry.sourceUrl)
    setLicense(entry.license)
    setAttribution(entry.attribution)
    setSettings(entry.settings)
    setNotes(entry.notes)
    setLinkedAssetId(entry.linkedAssetId ?? '')
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
    setScores(emptyScores())
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
          <span className="prompt-entry-card__prompt-preview">{entry.name}</span>
          <span className="muted prompt-entry-card__meta">
            {SFX_SOURCE_LABELS[entry.source]} · {formatDate(entry.createdAt)}
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
                Source
                <select value={source} onChange={(e) => setSource(e.target.value as SfxSource)}>
                  <option value="licensed">{SFX_SOURCE_LABELS.licensed}</option>
                  <option value="elevenlabs">{SFX_SOURCE_LABELS.elevenlabs}</option>
                </select>
              </label>
              <label className="shot-card__field">
                Name
                <input value={name} onChange={(e) => setName(e.target.value)} />
              </label>
              <label className="shot-card__field">
                Prompt / search term
                <textarea
                  value={promptText}
                  onChange={(e) => setPromptText(e.target.value)}
                  rows={3}
                  placeholder={SFX_PROMPT_PLACEHOLDER[source]}
                />
              </label>
              {source === 'elevenlabs' && (
                <label className="shot-card__field">
                  Settings
                  <textarea
                    value={settings}
                    onChange={(e) => setSettings(e.target.value)}
                    rows={2}
                    placeholder="Model/voice/style params (optional)"
                  />
                </label>
              )}
              {source === 'licensed' && (
                <>
                  <label className="shot-card__field">
                    Source URL
                    <input value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} />
                  </label>
                  <label className="shot-card__field">
                    License
                    <input
                      value={license}
                      onChange={(e) => setLicense(e.target.value)}
                      placeholder="e.g. CC0, CC-BY 4.0, Pixabay License"
                    />
                  </label>
                  <label className="shot-card__field">
                    Attribution text
                    <textarea value={attribution} onChange={(e) => setAttribution(e.target.value)} rows={2} />
                  </label>
                </>
              )}
              <label className="shot-card__field">
                Notes
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
              </label>
              <label className="shot-card__field">
                Tags (comma-separated)
                <input value={tagsText} onChange={(e) => setTagsText(e.target.value)} />
              </label>
              <label className="shot-card__field">
                Linked audio asset
                <select value={linkedAssetId} onChange={(e) => setLinkedAssetId(e.target.value)}>
                  <option value="">None</option>
                  {assets
                    .filter((a) => a.kind === 'audio')
                    .map((asset) => (
                      <option key={asset.id} value={asset.id}>
                        {asset.originalName}
                      </option>
                    ))}
                </select>
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
                <div className="muted field-label">Prompt / search term</div>
                <p className="prompt-entry-card__text">{entry.promptText || '(none)'}</p>
              </div>
              {entry.source === 'elevenlabs' && entry.settings && (
                <div className="prompt-entry-card__field-block">
                  <div className="muted field-label">Settings</div>
                  <p className="prompt-entry-card__text">{entry.settings}</p>
                </div>
              )}
              {entry.source === 'licensed' && (
                <div className="prompt-entry-card__field-block">
                  <div className="muted field-label">License</div>
                  <p className="prompt-entry-card__text">{entry.license || 'Not set'}</p>
                  {entry.attribution && <p className="prompt-entry-card__text sfx-card__attribution">{entry.attribution}</p>}
                </div>
              )}
              {entry.notes && (
                <div className="prompt-entry-card__field-block">
                  <div className="muted field-label">Notes</div>
                  <p className="prompt-entry-card__text">{entry.notes}</p>
                </div>
              )}
              <div className="prompt-entry-card__field-block">
                <div className="muted field-label">Linked audio asset</div>
                <p className="prompt-entry-card__text">
                  {entry.linkedAssetId
                    ? assets.find((a) => a.id === entry.linkedAssetId)?.originalName ?? 'linked asset'
                    : 'None yet'}
                </p>
              </div>
            </>
          )}

          {!editing && (
            <div className="prompt-entry-card__actions">
              {entry.promptText && (
                <button className="btn" onClick={handleCopyPrompt}>
                  {copied ? 'Copied!' : 'Copy Prompt'}
                </button>
              )}
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
                placeholder="Recipe name, e.g. Reliable heavy door creak"
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
                  {SFX_RATING_DIMENSIONS.map((d) => (
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
                  {SFX_RATING_DIMENSIONS.map((d) => (
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
