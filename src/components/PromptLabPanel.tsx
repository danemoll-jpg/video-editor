import { useEffect, useState } from 'react'
import type { Asset, PromptEntry, Recipe, RatingInput, PromptEntryUpdates } from '../api'
import {
  PROMPT_LAB_LABELS,
  PROMPT_LAB_PROMPT_PLACEHOLDER,
  RATING_DIMENSIONS,
  labUsesLyrics,
  type PromptLabKind,
} from '../../electron/promptLabTypes'
import PromptEntryCard from './PromptEntryCard'
import RecipeCard from './RecipeCard'
import VersionCompare from './VersionCompare'
import AiAssistantPanel from './AiAssistantPanel'

interface Props {
  projectId: string
  kind: PromptLabKind
  assets: Asset[]
  /**
   * The entry a "Draft Prompt" navigation (2026-09-14: Grok, then Suno for
   * Phase 8) landed on, if any — expands the AI Assistant and scrolls/
   * expands that entry's card. `PromptLab` only ever passes this when its
   * `focusKind` matches this panel's own `kind`.
   */
  focusEntryId?: string | null
  /**
   * The entry id (if any) whose prompt text field should be overwritten
   * automatically with the AI Assistant's *next* reply, instead of the
   * normal manual-"Insert" flow — set only right after a fresh draft
   * request was placed unsent into the composer (same revision as
   * `focusEntryId` above).
   */
  autoInsertEntryId?: string | null
  /** Called once that auto-insert has actually happened, so the caller can clear its armed state. */
  onAutoInsertConsumed?: () => void
}

const EMPTY_FORM = { promptText: '', lyrics: '', settings: '', notes: '', tagsText: '', linkedAssetId: '' }

/**
 * One lab's full history/ratings/recipes UI (Grok Prompt Lab or Suno Music
 * Lab) — reused across both via `kind`, mirroring how promptLabManager.ts
 * is one manager for both. The unified SFX system (a merge of the old SFX
 * library and the old ElevenLabs prompt-lab kind — see
 * electron/sfxLibraryManager.ts) has its own SfxPanel, structurally similar
 * but with a source-conditional set of extra fields instead of a fixed
 * `kind`.
 */
export default function PromptLabPanel({
  projectId,
  kind,
  assets,
  focusEntryId,
  autoInsertEntryId,
  onAutoInsertConsumed,
}: Props) {
  const [entries, setEntries] = useState<PromptEntry[]>([])
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [form, setForm] = useState(EMPTY_FORM)
  const [parentId, setParentId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)

  const [compareIds, setCompareIds] = useState<string[]>([])
  const [showRecipes, setShowRecipes] = useState(false)

  const dimensions = RATING_DIMENSIONS[kind]
  const showLyrics = labUsesLyrics(kind)

  async function refresh() {
    setLoading(true)
    try {
      const [e, r] = await Promise.all([
        window.api.listPromptEntries(projectId, kind),
        window.api.listRecipes(projectId, kind),
      ])
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
  }, [projectId, kind])

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
    if (!form.promptText.trim() || saving) return
    setSaving(true)
    await guard(async () => {
      setEntries(
        await window.api.createPromptEntry(projectId, kind, {
          promptText: form.promptText,
          lyrics: form.lyrics,
          settings: form.settings,
          notes: form.notes,
          tags: form.tagsText
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean),
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

  function handleUpdateEntry(entryId: string, updates: PromptEntryUpdates) {
    guard(async () => setEntries(await window.api.updatePromptEntry(projectId, kind, entryId, updates)))
  }

  function handleDeleteEntry(entryId: string) {
    if (!window.confirm('Delete this prompt history entry? This cannot be undone.')) return
    guard(async () => {
      setEntries(await window.api.deletePromptEntry(projectId, kind, entryId))
      setCompareIds((ids) => ids.filter((id) => id !== entryId))
    })
  }

  function handleAddRating(entryId: string, input: RatingInput) {
    guard(async () => setEntries(await window.api.addRating(projectId, kind, entryId, input)))
  }

  function handleDeleteRating(entryId: string, ratingId: string) {
    guard(async () => setEntries(await window.api.deleteRating(projectId, kind, entryId, ratingId)))
  }

  function handlePromote(entryId: string, name: string) {
    guard(async () => setRecipes(await window.api.promoteToRecipe(projectId, kind, entryId, name)))
  }

  function handleRenameRecipe(recipeId: string, name: string) {
    guard(async () => setRecipes(await window.api.updateRecipe(projectId, kind, recipeId, { name })))
  }

  function handleDeleteRecipe(recipeId: string) {
    if (!window.confirm('Delete this recipe?')) return
    guard(async () => setRecipes(await window.api.deleteRecipe(projectId, kind, recipeId)))
  }

  function toggleCompare(entryId: string) {
    setCompareIds((ids) => {
      if (ids.includes(entryId)) return ids.filter((id) => id !== entryId)
      if (ids.length >= 2) return ids
      return [...ids, entryId]
    })
  }

  const compareEntries =
    compareIds.length === 2
      ? ([entries.find((e) => e.id === compareIds[0]), entries.find((e) => e.id === compareIds[1])].filter(
          Boolean,
        ) as PromptEntry[])
      : []

  if (loading) return <p className="muted">Loading history…</p>

  return (
    <div className="prompt-lab-panel">
      <AiAssistantPanel
        projectId={projectId}
        context={kind}
        label={`${PROMPT_LAB_LABELS[kind]} Assistant`}
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
          entries={[compareEntries[0], compareEntries[1]]}
          dimensions={dimensions}
          showLyrics={showLyrics}
          onClose={() => setCompareIds([])}
        />
      )}

      <div className="tab-panel__toolbar">
        <span className="muted">
          {compareIds.length > 0
            ? `${compareIds.length}/2 selected for comparison`
            : 'Select two entries below to compare versions.'}
        </span>
        <div className="spacer" />
        <button className="btn" onClick={() => setShowRecipes(!showRecipes)}>
          {showRecipes ? 'Hide' : 'Show'} Recipes ({recipes.length})
        </button>
        <button className="btn btn--primary" onClick={() => (showForm ? setShowForm(false) : openNewEntryForm())}>
          {showForm ? 'Cancel' : '+ New Prompt'}
        </button>
      </div>

      {showRecipes && (
        <section className="recipe-section">
          <h3>Recipes</h3>
          {recipes.length === 0 ? (
            <p className="muted">
              No recipes yet. Promote a prompt entry from the history below once its wording is working
              well, and it'll show up here as a reusable starting point.
            </p>
          ) : (
            recipes.map((recipe) => (
              <RecipeCard
                key={recipe.id}
                recipe={recipe}
                showLyrics={showLyrics}
                onRename={(name) => handleRenameRecipe(recipe.id, name)}
                onDelete={() => handleDeleteRecipe(recipe.id)}
                onUseAsNewEntry={() =>
                  openNewEntryForm({
                    promptText: recipe.promptText,
                    lyrics: recipe.lyrics,
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
            Prompt
            <textarea
              value={form.promptText}
              onChange={(e) => setForm((f) => ({ ...f, promptText: e.target.value }))}
              rows={3}
              placeholder={PROMPT_LAB_PROMPT_PLACEHOLDER[kind]}
              autoFocus
            />
          </label>
          {showLyrics && (
            <label className="shot-card__field">
              Lyrics
              <textarea
                value={form.lyrics}
                onChange={(e) => setForm((f) => ({ ...f, lyrics: e.target.value }))}
                rows={4}
                placeholder="Lyrics to paste into Suno (optional)"
              />
            </label>
          )}
          <label className="shot-card__field">
            Settings
            <textarea
              value={form.settings}
              onChange={(e) => setForm((f) => ({ ...f, settings: e.target.value }))}
              rows={2}
              placeholder="Model/voice/style params (optional)"
            />
          </label>
          <label className="shot-card__field">
            Notes
            <textarea
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              rows={2}
              placeholder="Notes (optional)"
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
            Linked asset
            <select
              value={form.linkedAssetId}
              onChange={(e) => setForm((f) => ({ ...f, linkedAssetId: e.target.value }))}
            >
              <option value="">None — link once the generated file's been imported, or leave unlinked</option>
              {assets.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.originalName}
                </option>
              ))}
            </select>
          </label>
          <div className="shot-card__field-actions">
            <button
              className="btn btn--primary"
              disabled={!form.promptText.trim() || saving}
              onClick={handleSubmitEntry}
            >
              {saving ? 'Saving…' : 'Save Prompt'}
            </button>
          </div>
        </div>
      )}

      {entries.length === 0 ? (
        <p className="muted">No prompt history yet. Add your first prompt above.</p>
      ) : (
        <div className="prompt-entry-list">
          {entries.map((entry) => (
            <PromptEntryCard
              key={entry.id}
              entry={entry}
              dimensions={dimensions}
              showLyrics={showLyrics}
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
                    promptText: entry.promptText,
                    lyrics: entry.lyrics,
                    settings: entry.settings,
                    notes: '',
                    tagsText: entry.tags.join(', '),
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
