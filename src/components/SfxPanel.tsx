import { useEffect, useState } from 'react'
import type { Asset, SfxEntry, SfxEntryUpdates, SfxRatingInput, SfxRecipe } from '../api'
import { SFX_RATING_DIMENSIONS, SFX_PROMPT_PLACEHOLDER, type SfxSource } from '../../electron/sfxTypes'
import SfxEntryCard from './SfxEntryCard'
import RecipeCard from './RecipeCard'
import VersionCompare, { type CompareEntry } from './VersionCompare'
import AiAssistantPanel from './AiAssistantPanel'

interface Props {
  projectId: string
  assets: Asset[]
  /**
   * The entry a "🔊 Draft SFX Prompt" shot navigation (Phase 8, 2026-09-14)
   * landed on, if any — expands the AI Assistant and scrolls/expands that
   * entry's card. `PromptLab` only ever passes this when its `focusKind` is
   * `'sfx'`. Mirrors `PromptLabPanel`'s identical prop.
   */
  focusEntryId?: string | null
  /**
   * The entry id (if any) whose prompt text field should be overwritten
   * automatically with the AI Assistant's *next* reply, instead of the
   * normal manual-"Insert" flow — set only right after a fresh draft
   * request was placed unsent into the composer.
   */
  autoInsertEntryId?: string | null
  /** Called once that auto-insert has actually happened, so the caller can clear its armed state. */
  onAutoInsertConsumed?: () => void
}

const EMPTY_FORM = {
  source: 'licensed' as SfxSource,
  name: '',
  promptText: '',
  tagsText: '',
  sourceUrl: '',
  license: '',
  attribution: '',
  settings: '',
  notes: '',
  linkedAssetId: '',
}

/** Adapts an SfxEntry to VersionCompare's structural CompareEntry shape (shared with PromptEntry — see VersionCompare.tsx). */
function toCompareEntry(entry: SfxEntry): CompareEntry {
  return { id: entry.id, createdAt: entry.createdAt, promptText: entry.promptText, settings: entry.settings, ratings: entry.ratings }
}

/**
 * The unified SFX system (Phase 5 merge of the old SFX library and the old
 * ElevenLabs prompt-lab kind — see electron/sfxLibraryManager.ts's header
 * comment). Every entry, regardless of its `source` (free/licensed download
 * or ElevenLabs generation), gets the same prompt/search-term field,
 * version history, ratings, and recipe-promotion — mirrors PromptLabPanel's
 * structure closely, since it's effectively a fourth "prompt lab" now, just
 * with a source-conditional set of extra fields (license/attribution for
 * licensed, settings for elevenlabs) instead of a fixed `kind`.
 */
export default function SfxPanel({ projectId, assets, focusEntryId, autoInsertEntryId, onAutoInsertConsumed }: Props) {
  const [entries, setEntries] = useState<SfxEntry[]>([])
  const [recipes, setRecipes] = useState<SfxRecipe[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [form, setForm] = useState(EMPTY_FORM)
  const [parentId, setParentId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)

  const [compareIds, setCompareIds] = useState<string[]>([])
  const [showRecipes, setShowRecipes] = useState(false)

  async function refresh() {
    setLoading(true)
    try {
      const [e, r] = await Promise.all([window.api.listSfxEntries(projectId), window.api.listSfxRecipes(projectId)])
      setEntries(e)
      setRecipes(r)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
    setCompareIds([])
    setShowForm(false)
    setForm(EMPTY_FORM)
    setParentId(null)
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

  function openNewEntryForm(seed?: Partial<typeof EMPTY_FORM>, fromParentId?: string | null) {
    setForm({ ...EMPTY_FORM, ...seed })
    setParentId(fromParentId ?? null)
    setShowForm(true)
  }

  async function handleSubmitEntry() {
    if (!form.name.trim() || saving) return
    setSaving(true)
    await guard(async () => {
      setEntries(
        await window.api.createSfxEntry(projectId, {
          source: form.source,
          name: form.name,
          promptText: form.promptText,
          tags: form.tagsText
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean),
          sourceUrl: form.sourceUrl,
          license: form.license,
          attribution: form.attribution,
          settings: form.settings,
          notes: form.notes,
          parentId,
          linkedAssetId: form.linkedAssetId || null,
        }),
      )
      setForm(EMPTY_FORM)
      setParentId(null)
      setShowForm(false)
    })
    setSaving(false)
  }

  function handleUpdateEntry(sfxId: string, updates: SfxEntryUpdates) {
    guard(async () => setEntries(await window.api.updateSfxEntry(projectId, sfxId, updates)))
  }

  function handleDeleteEntry(sfxId: string) {
    if (!window.confirm('Delete this SFX entry? This cannot be undone.')) return
    guard(async () => {
      setEntries(await window.api.deleteSfxEntry(projectId, sfxId))
      setCompareIds((ids) => ids.filter((id) => id !== sfxId))
    })
  }

  function handleAddRating(sfxId: string, input: SfxRatingInput) {
    guard(async () => setEntries(await window.api.addSfxRating(projectId, sfxId, input)))
  }

  function handleDeleteRating(sfxId: string, ratingId: string) {
    guard(async () => setEntries(await window.api.deleteSfxRating(projectId, sfxId, ratingId)))
  }

  function handlePromote(sfxId: string, name: string) {
    guard(async () => setRecipes(await window.api.promoteSfxRecipe(projectId, sfxId, name)))
  }

  function handleRenameRecipe(recipeId: string, name: string) {
    guard(async () => setRecipes(await window.api.updateSfxRecipe(projectId, recipeId, { name })))
  }

  function handleDeleteRecipe(recipeId: string) {
    if (!window.confirm('Delete this recipe?')) return
    guard(async () => setRecipes(await window.api.deleteSfxRecipe(projectId, recipeId)))
  }

  function toggleCompare(sfxId: string) {
    setCompareIds((ids) => {
      if (ids.includes(sfxId)) return ids.filter((id) => id !== sfxId)
      if (ids.length >= 2) return ids
      return [...ids, sfxId]
    })
  }

  const compareEntries =
    compareIds.length === 2
      ? ([entries.find((e) => e.id === compareIds[0]), entries.find((e) => e.id === compareIds[1])].filter(
          Boolean,
        ) as SfxEntry[])
      : []

  if (loading) return <p className="muted">Loading SFX…</p>

  return (
    <div className="prompt-lab-panel">
      <AiAssistantPanel
        projectId={projectId}
        context="elevenlabs"
        label="SFX Assistant"
        autoOpen={!!focusEntryId}
        onInsert={(text) => {
          setForm((f) => ({ ...f, promptText: text }))
          setShowForm(true)
        }}
        onAutoInsert={
          autoInsertEntryId
            ? (text) => {
                handleUpdateEntry(autoInsertEntryId, { promptText: text })
                onAutoInsertConsumed?.()
              }
            : undefined
        }
      />

      {error && <div className="error-banner">{error}</div>}

      {compareEntries.length === 2 && (
        <VersionCompare
          entries={[toCompareEntry(compareEntries[0]), toCompareEntry(compareEntries[1])]}
          dimensions={SFX_RATING_DIMENSIONS}
          showLyrics={false}
          onClose={() => setCompareIds([])}
        />
      )}

      <div className="tab-panel__toolbar">
        <span className="muted">
          {compareIds.length > 0
            ? `${compareIds.length}/2 selected for comparison`
            : 'Free/licensed downloads and ElevenLabs generations, one unified list. Select two entries to compare versions.'}
        </span>
        <div className="spacer" />
        <button className="btn" onClick={() => setShowRecipes(!showRecipes)}>
          {showRecipes ? 'Hide' : 'Show'} Recipes ({recipes.length})
        </button>
        <button className="btn btn--primary" onClick={() => (showForm ? setShowForm(false) : openNewEntryForm())}>
          {showForm ? 'Cancel' : '+ Add SFX'}
        </button>
      </div>

      {showRecipes && (
        <section className="recipe-section">
          <h3>Recipes</h3>
          {recipes.length === 0 ? (
            <p className="muted">
              No recipes yet. Promote an SFX entry from the list below once its wording/search term is
              working well, and it'll show up here as a reusable starting point.
            </p>
          ) : (
            recipes.map((recipe) => (
              <RecipeCard
                key={recipe.id}
                recipe={recipe}
                showLyrics={false}
                onRename={(name) => handleRenameRecipe(recipe.id, name)}
                onDelete={() => handleDeleteRecipe(recipe.id)}
                onUseAsNewEntry={() =>
                  openNewEntryForm({
                    promptText: recipe.promptText,
                    settings: recipe.settings,
                    notes: recipe.notes,
                    tagsText: recipe.tags.join(', '),
                  })
                }
              />
            ))
          )}
        </section>
      )}

      {showForm && (
        <div className="inline-form inline-form--column new-prompt-form">
          {parentId && <p className="muted">New version, linked back to its source entry.</p>}
          <label className="shot-card__field">
            Source
            <select
              value={form.source}
              onChange={(e) => setForm((f) => ({ ...f, source: e.target.value as SfxSource }))}
            >
              <option value="licensed">Free / Licensed</option>
              <option value="elevenlabs">ElevenLabs (generated)</option>
            </select>
          </label>
          <label className="shot-card__field">
            Name
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Heavy door creak"
              autoFocus
            />
          </label>
          <label className="shot-card__field">
            Prompt / search term
            <textarea
              value={form.promptText}
              onChange={(e) => setForm((f) => ({ ...f, promptText: e.target.value }))}
              rows={3}
              placeholder={SFX_PROMPT_PLACEHOLDER[form.source]}
            />
          </label>
          {form.source === 'elevenlabs' && (
            <label className="shot-card__field">
              Settings
              <textarea
                value={form.settings}
                onChange={(e) => setForm((f) => ({ ...f, settings: e.target.value }))}
                rows={2}
                placeholder="Model/voice/style params (optional)"
              />
            </label>
          )}
          {form.source === 'licensed' && (
            <>
              <label className="shot-card__field">
                Source URL
                <input
                  value={form.sourceUrl}
                  onChange={(e) => setForm((f) => ({ ...f, sourceUrl: e.target.value }))}
                  placeholder="Where it was downloaded from"
                />
              </label>
              <label className="shot-card__field">
                License
                <input
                  value={form.license}
                  onChange={(e) => setForm((f) => ({ ...f, license: e.target.value }))}
                  placeholder="e.g. CC0, CC-BY 4.0, Pixabay License"
                />
              </label>
              <label className="shot-card__field">
                Attribution text
                <textarea
                  value={form.attribution}
                  onChange={(e) => setForm((f) => ({ ...f, attribution: e.target.value }))}
                  rows={2}
                  placeholder="Exact credit line required by the license, if any"
                />
              </label>
            </>
          )}
          <label className="shot-card__field">
            Notes
            <textarea
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              rows={2}
            />
          </label>
          <label className="shot-card__field">
            Tags (comma-separated)
            <input
              value={form.tagsText}
              onChange={(e) => setForm((f) => ({ ...f, tagsText: e.target.value }))}
            />
          </label>
          <label className="shot-card__field">
            Linked audio asset
            <select
              value={form.linkedAssetId}
              onChange={(e) => setForm((f) => ({ ...f, linkedAssetId: e.target.value }))}
            >
              <option value="">None — import the file via the Assets tab first, then link it here</option>
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
            <button className="btn btn--primary" disabled={!form.name.trim() || saving} onClick={handleSubmitEntry}>
              {saving ? 'Saving…' : 'Save SFX'}
            </button>
          </div>
        </div>
      )}

      {entries.length === 0 ? (
        <p className="muted">
          No SFX yet. Add your first one above — a free/licensed download (with its license and search
          term) or an ElevenLabs generation (with its prompt).
        </p>
      ) : (
        <div className="prompt-entry-list">
          {entries.map((entry) => (
            <SfxEntryCard
              key={entry.id}
              entry={entry}
              assets={assets}
              parentEntry={entry.parentId ? entries.find((e) => e.id === entry.parentId) : undefined}
              compareSelected={compareIds.includes(entry.id)}
              compareDisabled={compareIds.length >= 2}
              autoExpand={entry.id === focusEntryId}
              onToggleCompare={() => toggleCompare(entry.id)}
              onUpdate={(updates) => handleUpdateEntry(entry.id, updates)}
              onDelete={() => handleDeleteEntry(entry.id)}
              onAddRating={(input) => handleAddRating(entry.id, input)}
              onDeleteRating={(ratingId) => handleDeleteRating(entry.id, ratingId)}
              onPromote={(name) => handlePromote(entry.id, name)}
              onNewVersion={() =>
                openNewEntryForm(
                  {
                    source: entry.source,
                    name: entry.name,
                    promptText: entry.promptText,
                    settings: entry.settings,
                    notes: '',
                    tagsText: entry.tags.join(', '),
                    sourceUrl: entry.sourceUrl,
                    license: entry.license,
                    attribution: entry.attribution,
                  },
                  entry.id,
                )
              }
            />
          ))}
        </div>
      )}
    </div>
  )
}
