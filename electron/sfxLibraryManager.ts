import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { pathExists, readJsonFile, writeJsonFile } from './fsUtils'
import { requireProjectDir, touchProject } from './projectPaths'
import { SFX_RATING_DIMENSIONS, type SfxSource } from './sfxTypes'

// --- Data model -------------------------------------------------------
//
// Phase 5 merge: this used to be two separate Phase 3 subsystems — the SFX
// *library* (tagged free/licensed assets with license/attribution tracking,
// no ratings/recipes) and the ElevenLabs SFX prompt history (a
// promptLabManager.ts "kind" with full history/ratings/version-chain/
// recipes, but no license tracking). Both are "an SFX, with some source,"
// so as of this merge they're one system: every entry carries a `source`
// (`licensed` or `elevenlabs`) and, regardless of source, gets the same
// prompt/search-term text, version history (`parentId` chain), per-clip
// ratings, and recipe-promotion — a free/licensed sound's "prompt" is the
// search term used to find it, just as worth tracking as AI-generation
// wording is. `sourceUrl`/`license`/`attribution` stay meaningful mainly for
// `licensed` entries and `settings` mainly for `elevenlabs` ones, but
// they're plain optional strings on every entry rather than a
// source-conditional shape, to keep this one flat type instead of a
// discriminated union.
//
// Stored at `promptlab/sfxEntries.json` + `promptlab/sfxRecipes.json` (see
// projectManager.ts for the project folder layout). `linkedAssetId` still
// optionally points at an already-imported audio asset (projectManager.ts:
// `assets/audio/...`), same as before the merge.
//
// **Data migration:** existing projects have their old data in
// `promptlab/sfxLibrary.json` (the old SfxLibraryManager shape) and
// `promptlab/elevenlabsPrompts.json` + `elevenlabsRecipes.json` (the old
// promptLabManager.ts 'elevenlabs' kind). `ensureMigrated` runs once per
// project, the first time this manager touches it: if `sfxEntries.json`
// doesn't exist yet, it reads whatever legacy files exist, converts each
// into the unified shape, and writes the result as the new unified files —
// nothing existing is reset or discarded. The legacy files themselves are
// left in place afterward (harmless leftovers, same "don't delete what
// nobody asked to delete" call as this project's other migrations) rather
// than deleted; nothing reads them again once `sfxEntries.json` exists.

export interface SfxRating {
  id: string
  clipLabel: string
  linkedAssetId: string | null
  scores: Record<string, number>
  notes: string
  createdAt: string
}

export interface SfxEntry {
  id: string
  source: SfxSource
  name: string
  /** Generic "Prompt / search term" field — an AI generation prompt (elevenlabs) or the search term used to find a free/licensed sound (licensed). */
  promptText: string
  tags: string[]
  sourceUrl: string
  license: string
  attribution: string
  settings: string
  notes: string
  parentId: string | null
  linkedAssetId: string | null
  ratings: SfxRating[]
  createdAt: string
  updatedAt: string
}

export interface SfxRecipe {
  id: string
  name: string
  promptText: string
  settings: string
  notes: string
  tags: string[]
  sourceEntryId: string | null
  createdAt: string
  updatedAt: string
}

export interface SfxEntryInput {
  source: SfxSource
  name: string
  promptText?: string
  tags?: string[]
  sourceUrl?: string
  license?: string
  attribution?: string
  settings?: string
  notes?: string
  parentId?: string | null
  linkedAssetId?: string | null
}

export interface SfxEntryUpdates {
  source?: SfxSource
  name?: string
  promptText?: string
  tags?: string[]
  sourceUrl?: string
  license?: string
  attribution?: string
  settings?: string
  notes?: string
  linkedAssetId?: string | null
}

export interface SfxRatingInput {
  clipLabel: string
  linkedAssetId?: string | null
  scores: Record<string, number>
  notes?: string
}

export interface SfxRatingUpdates {
  clipLabel?: string
  linkedAssetId?: string | null
  scores?: Record<string, number>
  notes?: string
}

// --- Legacy shapes, read-only, migration purposes only ---------------------

interface LegacySfxLibraryEntry {
  id: string
  name: string
  tags: string[]
  sourceUrl: string
  license: string
  attribution: string
  linkedAssetId: string | null
  notes: string
  createdAt: string
  updatedAt: string
}

interface LegacyPromptRating {
  id: string
  clipLabel: string
  linkedAssetId: string | null
  scores: Record<string, number>
  notes: string
  createdAt: string
}

interface LegacyPromptEntry {
  id: string
  promptText: string
  settings: string
  notes: string
  tags: string[]
  parentId: string | null
  linkedAssetId: string | null
  ratings: LegacyPromptRating[]
  createdAt: string
  updatedAt: string
}

interface LegacyRecipe {
  id: string
  name: string
  promptText: string
  settings: string
  notes: string
  tags: string[]
  sourceEntryId: string | null
  createdAt: string
  updatedAt: string
}

function entriesPath(dir: string): string {
  return path.join(dir, 'promptlab', 'sfxEntries.json')
}
function recipesPath(dir: string): string {
  return path.join(dir, 'promptlab', 'sfxRecipes.json')
}
function legacySfxLibraryPath(dir: string): string {
  return path.join(dir, 'promptlab', 'sfxLibrary.json')
}
function legacyElevenlabsPromptsPath(dir: string): string {
  return path.join(dir, 'promptlab', 'elevenlabsPrompts.json')
}
function legacyElevenlabsRecipesPath(dir: string): string {
  return path.join(dir, 'promptlab', 'elevenlabsRecipes.json')
}

/** Newest first — merging in the old ElevenLabs history's ordering, now applied to every entry regardless of source. */
function sortByCreatedDesc<T extends { createdAt: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/** Clamps each score in a dimension map to an integer 1-5, dropping unknown/invalid keys. */
function sanitizeScores(scores: Record<string, number>): Record<string, number> {
  const validKeys = new Set(SFX_RATING_DIMENSIONS.map((d) => d.key))
  const clean: Record<string, number> = {}
  for (const [key, value] of Object.entries(scores)) {
    if (!validKeys.has(key)) continue
    const n = Math.round(value)
    if (Number.isFinite(n)) clean[key] = Math.min(5, Math.max(1, n))
  }
  return clean
}

export class SfxLibraryManager {
  /** Migrates legacy `sfxLibrary.json` + `elevenlabsPrompts.json`/`elevenlabsRecipes.json` into the unified shape, once per project. No-op once `sfxEntries.json` exists. */
  private async ensureMigrated(dir: string): Promise<void> {
    if (await pathExists(entriesPath(dir))) return

    const legacySfx = await readJsonFile<LegacySfxLibraryEntry[]>(legacySfxLibraryPath(dir), [])
    const legacyPrompts = await readJsonFile<LegacyPromptEntry[]>(legacyElevenlabsPromptsPath(dir), [])
    const legacyRecipes = await readJsonFile<LegacyRecipe[]>(legacyElevenlabsRecipesPath(dir), [])

    const migratedEntries: SfxEntry[] = [
      ...legacySfx.map((e): SfxEntry => ({
        id: e.id,
        source: 'licensed',
        name: e.name,
        promptText: '',
        tags: e.tags,
        sourceUrl: e.sourceUrl,
        license: e.license,
        attribution: e.attribution,
        settings: '',
        notes: e.notes,
        parentId: null,
        linkedAssetId: e.linkedAssetId,
        ratings: [],
        createdAt: e.createdAt,
        updatedAt: e.updatedAt,
      })),
      ...legacyPrompts.map((e): SfxEntry => ({
        id: e.id,
        source: 'elevenlabs',
        name: e.promptText.length > 60 ? `${e.promptText.slice(0, 60)}…` : e.promptText || 'ElevenLabs SFX',
        promptText: e.promptText,
        tags: e.tags,
        sourceUrl: '',
        license: '',
        attribution: '',
        settings: e.settings,
        notes: e.notes,
        parentId: e.parentId,
        linkedAssetId: e.linkedAssetId,
        ratings: e.ratings.map((r) => ({
          id: r.id,
          clipLabel: r.clipLabel,
          linkedAssetId: r.linkedAssetId,
          scores: r.scores,
          notes: r.notes,
          createdAt: r.createdAt,
        })),
        createdAt: e.createdAt,
        updatedAt: e.updatedAt,
      })),
    ]

    const migratedRecipes: SfxRecipe[] = legacyRecipes.map((r) => ({
      id: r.id,
      name: r.name,
      promptText: r.promptText,
      settings: r.settings,
      notes: r.notes,
      tags: r.tags,
      sourceEntryId: r.sourceEntryId,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }))

    await writeJsonFile(entriesPath(dir), migratedEntries)
    await writeJsonFile(recipesPath(dir), migratedRecipes)
  }

  // --- Entries ------------------------------------------------------------

  async listEntries(projectId: string): Promise<SfxEntry[]> {
    const dir = await requireProjectDir(projectId)
    return sortByCreatedDesc(await this.readEntries(dir))
  }

  async createEntry(projectId: string, input: SfxEntryInput): Promise<SfxEntry[]> {
    const trimmedName = input.name.trim()
    if (!trimmedName) throw new Error('SFX name cannot be empty.')

    const dir = await requireProjectDir(projectId)
    const entries = await this.readEntries(dir)

    if (input.parentId && !entries.some((e) => e.id === input.parentId)) {
      throw new Error('Parent version not found.')
    }

    const now = new Date().toISOString()
    entries.push({
      id: randomUUID(),
      source: input.source,
      name: trimmedName,
      promptText: input.promptText ?? '',
      tags: input.tags ?? [],
      sourceUrl: input.sourceUrl ?? '',
      license: input.license ?? '',
      attribution: input.attribution ?? '',
      settings: input.settings ?? '',
      notes: input.notes ?? '',
      parentId: input.parentId ?? null,
      linkedAssetId: input.linkedAssetId ?? null,
      ratings: [],
      createdAt: now,
      updatedAt: now,
    })
    await this.writeEntries(dir, entries)
    await touchProject(dir)
    return sortByCreatedDesc(entries)
  }

  async updateEntry(projectId: string, sfxId: string, updates: SfxEntryUpdates): Promise<SfxEntry[]> {
    const dir = await requireProjectDir(projectId)
    const entries = await this.readEntries(dir)
    const entry = entries.find((e) => e.id === sfxId)
    if (!entry) throw new Error('SFX entry not found.')

    if (updates.name !== undefined) {
      const trimmed = updates.name.trim()
      if (!trimmed) throw new Error('SFX name cannot be empty.')
      entry.name = trimmed
    }
    if (updates.source !== undefined) entry.source = updates.source
    if (updates.promptText !== undefined) entry.promptText = updates.promptText
    if (updates.tags !== undefined) entry.tags = updates.tags
    if (updates.sourceUrl !== undefined) entry.sourceUrl = updates.sourceUrl
    if (updates.license !== undefined) entry.license = updates.license
    if (updates.attribution !== undefined) entry.attribution = updates.attribution
    if (updates.settings !== undefined) entry.settings = updates.settings
    if (updates.notes !== undefined) entry.notes = updates.notes
    if (updates.linkedAssetId !== undefined) entry.linkedAssetId = updates.linkedAssetId
    entry.updatedAt = new Date().toISOString()

    await this.writeEntries(dir, entries)
    await touchProject(dir)
    return sortByCreatedDesc(entries)
  }

  /** Deletes an entry. Any entries versioned off of it have their `parentId` cleared rather than being cascade-deleted, same policy as promptLabManager.ts. */
  async deleteEntry(projectId: string, sfxId: string): Promise<SfxEntry[]> {
    const dir = await requireProjectDir(projectId)
    const entries = await this.readEntries(dir)
    if (!entries.some((e) => e.id === sfxId)) throw new Error('SFX entry not found.')

    const remaining = entries.filter((e) => e.id !== sfxId)
    for (const e of remaining) {
      if (e.parentId === sfxId) e.parentId = null
    }
    await this.writeEntries(dir, remaining)
    await touchProject(dir)
    return sortByCreatedDesc(remaining)
  }

  // --- Ratings --------------------------------------------------------------

  async addRating(projectId: string, sfxId: string, input: SfxRatingInput): Promise<SfxEntry[]> {
    const trimmedLabel = input.clipLabel.trim()
    if (!trimmedLabel) throw new Error('Clip label cannot be empty.')

    const dir = await requireProjectDir(projectId)
    const entries = await this.readEntries(dir)
    const entry = entries.find((e) => e.id === sfxId)
    if (!entry) throw new Error('SFX entry not found.')

    const now = new Date().toISOString()
    entry.ratings.push({
      id: randomUUID(),
      clipLabel: trimmedLabel,
      linkedAssetId: input.linkedAssetId ?? null,
      scores: sanitizeScores(input.scores),
      notes: input.notes ?? '',
      createdAt: now,
    })
    entry.updatedAt = now

    await this.writeEntries(dir, entries)
    await touchProject(dir)
    return sortByCreatedDesc(entries)
  }

  async updateRating(
    projectId: string,
    sfxId: string,
    ratingId: string,
    updates: SfxRatingUpdates,
  ): Promise<SfxEntry[]> {
    const dir = await requireProjectDir(projectId)
    const entries = await this.readEntries(dir)
    const entry = entries.find((e) => e.id === sfxId)
    if (!entry) throw new Error('SFX entry not found.')
    const rating = entry.ratings.find((r) => r.id === ratingId)
    if (!rating) throw new Error('Rating not found.')

    if (updates.clipLabel !== undefined) {
      const trimmed = updates.clipLabel.trim()
      if (!trimmed) throw new Error('Clip label cannot be empty.')
      rating.clipLabel = trimmed
    }
    if (updates.linkedAssetId !== undefined) rating.linkedAssetId = updates.linkedAssetId
    if (updates.scores !== undefined) rating.scores = sanitizeScores(updates.scores)
    if (updates.notes !== undefined) rating.notes = updates.notes
    entry.updatedAt = new Date().toISOString()

    await this.writeEntries(dir, entries)
    await touchProject(dir)
    return sortByCreatedDesc(entries)
  }

  async deleteRating(projectId: string, sfxId: string, ratingId: string): Promise<SfxEntry[]> {
    const dir = await requireProjectDir(projectId)
    const entries = await this.readEntries(dir)
    const entry = entries.find((e) => e.id === sfxId)
    if (!entry) throw new Error('SFX entry not found.')
    if (!entry.ratings.some((r) => r.id === ratingId)) throw new Error('Rating not found.')

    entry.ratings = entry.ratings.filter((r) => r.id !== ratingId)
    entry.updatedAt = new Date().toISOString()

    await this.writeEntries(dir, entries)
    await touchProject(dir)
    return sortByCreatedDesc(entries)
  }

  // --- Recipes ----------------------------------------------------------

  async listRecipes(projectId: string): Promise<SfxRecipe[]> {
    const dir = await requireProjectDir(projectId)
    return sortByCreatedDesc(await this.readRecipes(dir))
  }

  async promoteToRecipe(projectId: string, sfxId: string, name: string): Promise<SfxRecipe[]> {
    const trimmedName = name.trim()
    if (!trimmedName) throw new Error('Recipe name cannot be empty.')

    const dir = await requireProjectDir(projectId)
    const entries = await this.readEntries(dir)
    const entry = entries.find((e) => e.id === sfxId)
    if (!entry) throw new Error('SFX entry not found.')

    const recipes = await this.readRecipes(dir)
    const now = new Date().toISOString()
    recipes.push({
      id: randomUUID(),
      name: trimmedName,
      promptText: entry.promptText,
      settings: entry.settings,
      notes: entry.notes,
      tags: entry.tags,
      sourceEntryId: entry.id,
      createdAt: now,
      updatedAt: now,
    })
    await this.writeRecipes(dir, recipes)
    await touchProject(dir)
    return sortByCreatedDesc(recipes)
  }

  async updateRecipe(
    projectId: string,
    recipeId: string,
    updates: { name?: string; promptText?: string; settings?: string; notes?: string; tags?: string[] },
  ): Promise<SfxRecipe[]> {
    const dir = await requireProjectDir(projectId)
    const recipes = await this.readRecipes(dir)
    const recipe = recipes.find((r) => r.id === recipeId)
    if (!recipe) throw new Error('Recipe not found.')

    if (updates.name !== undefined) {
      const trimmed = updates.name.trim()
      if (!trimmed) throw new Error('Recipe name cannot be empty.')
      recipe.name = trimmed
    }
    if (updates.promptText !== undefined) recipe.promptText = updates.promptText
    if (updates.settings !== undefined) recipe.settings = updates.settings
    if (updates.notes !== undefined) recipe.notes = updates.notes
    if (updates.tags !== undefined) recipe.tags = updates.tags
    recipe.updatedAt = new Date().toISOString()

    await this.writeRecipes(dir, recipes)
    await touchProject(dir)
    return sortByCreatedDesc(recipes)
  }

  async deleteRecipe(projectId: string, recipeId: string): Promise<SfxRecipe[]> {
    const dir = await requireProjectDir(projectId)
    const recipes = await this.readRecipes(dir)
    if (!recipes.some((r) => r.id === recipeId)) throw new Error('Recipe not found.')

    const remaining = recipes.filter((r) => r.id !== recipeId)
    await this.writeRecipes(dir, remaining)
    await touchProject(dir)
    return sortByCreatedDesc(remaining)
  }

  // --- Storage --------------------------------------------------------------

  private async readEntries(dir: string): Promise<SfxEntry[]> {
    await this.ensureMigrated(dir)
    return readJsonFile<SfxEntry[]>(entriesPath(dir), [])
  }

  private async writeEntries(dir: string, entries: SfxEntry[]): Promise<void> {
    await writeJsonFile(entriesPath(dir), entries)
  }

  private async readRecipes(dir: string): Promise<SfxRecipe[]> {
    await this.ensureMigrated(dir)
    return readJsonFile<SfxRecipe[]>(recipesPath(dir), [])
  }

  private async writeRecipes(dir: string, recipes: SfxRecipe[]): Promise<void> {
    await writeJsonFile(recipesPath(dir), recipes)
  }
}
