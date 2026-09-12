import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { readJsonFile, writeJsonFile } from './fsUtils'
import { requireProjectDir, touchProject } from './projectPaths'
import { RATING_DIMENSIONS, type PromptLabKind } from './promptLabTypes'

// --- Data model -------------------------------------------------------
//
// Phase 3's three "prompt lab" subsystems — Grok Prompt Lab, Suno Music Lab,
// and the ElevenLabs SFX prompt history — all follow the same shape (full
// prompt history, per-clip ratings, version comparison via a parentId
// chain, and promotion of successful wording into reusable "recipes"), so
// one manager owns all three, parameterized by `kind`, rather than
// tripling near-identical code across three managers. The SFX *library*
// (tagged licensed assets, a different shape entirely) is its own
// sfxLibraryManager.ts.
//
// Each project's `promptlab/` folder (see projectManager.ts) holds, per
// kind:
//
//   promptlab/
//     grokPrompts.json        grokRecipes.json
//     sunoPrompts.json        sunoRecipes.json
//     elevenlabsPrompts.json  elevenlabsRecipes.json
//     sfxLibrary.json         (owned by sfxLibraryManager.ts, not here)
//
// A PromptEntry's `parentId` optionally points at the entry it was revised
// from, forming a version chain the renderer can walk to offer "compare
// this version against its parent" — comparison itself is just reading two
// entries side by side, so there's no separate comparison data to store.
// `lyrics` is only meaningful for Suno; other kinds just leave it ''.

export interface PromptRating {
  id: string
  clipLabel: string
  linkedAssetId: string | null
  scores: Record<string, number>
  notes: string
  createdAt: string
}

export interface PromptEntry {
  id: string
  kind: PromptLabKind
  promptText: string
  lyrics: string
  settings: string
  notes: string
  tags: string[]
  parentId: string | null
  linkedAssetId: string | null
  ratings: PromptRating[]
  createdAt: string
  updatedAt: string
}

export interface Recipe {
  id: string
  kind: PromptLabKind
  name: string
  promptText: string
  lyrics: string
  settings: string
  notes: string
  tags: string[]
  sourceEntryId: string | null
  createdAt: string
  updatedAt: string
}

export interface PromptEntryInput {
  promptText: string
  lyrics?: string
  settings?: string
  notes?: string
  tags?: string[]
  parentId?: string | null
  linkedAssetId?: string | null
}

export interface PromptEntryUpdates {
  promptText?: string
  lyrics?: string
  settings?: string
  notes?: string
  tags?: string[]
  linkedAssetId?: string | null
}

export interface RatingInput {
  clipLabel: string
  linkedAssetId?: string | null
  scores: Record<string, number>
  notes?: string
}

export interface RatingUpdates {
  clipLabel?: string
  linkedAssetId?: string | null
  scores?: Record<string, number>
  notes?: string
}

function promptsPath(dir: string, kind: PromptLabKind): string {
  return path.join(dir, 'promptlab', `${kind}Prompts.json`)
}
function recipesPath(dir: string, kind: PromptLabKind): string {
  return path.join(dir, 'promptlab', `${kind}Recipes.json`)
}

/** Newest first — this is a history log, not a manually-reorderable list. */
function sortByCreatedDesc<T extends { createdAt: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/** Clamps each score in a dimension map to an integer 1-5, dropping unknown/invalid keys. */
function sanitizeScores(kind: PromptLabKind, scores: Record<string, number>): Record<string, number> {
  const validKeys = new Set(RATING_DIMENSIONS[kind].map((d) => d.key))
  const clean: Record<string, number> = {}
  for (const [key, value] of Object.entries(scores)) {
    if (!validKeys.has(key)) continue
    const n = Math.round(value)
    if (Number.isFinite(n)) clean[key] = Math.min(5, Math.max(1, n))
  }
  return clean
}

export class PromptLabManager {
  // --- Prompt entries -----------------------------------------------------

  async listEntries(projectId: string, kind: PromptLabKind): Promise<PromptEntry[]> {
    const dir = await requireProjectDir(projectId)
    return sortByCreatedDesc(await this.readEntries(dir, kind))
  }

  async createEntry(
    projectId: string,
    kind: PromptLabKind,
    input: PromptEntryInput,
  ): Promise<PromptEntry[]> {
    const trimmed = input.promptText.trim()
    if (!trimmed) throw new Error('Prompt text cannot be empty.')

    const dir = await requireProjectDir(projectId)
    const entries = await this.readEntries(dir, kind)

    if (input.parentId && !entries.some((e) => e.id === input.parentId)) {
      throw new Error('Parent version not found.')
    }

    const now = new Date().toISOString()
    entries.push({
      id: randomUUID(),
      kind,
      promptText: trimmed,
      lyrics: input.lyrics ?? '',
      settings: input.settings ?? '',
      notes: input.notes ?? '',
      tags: input.tags ?? [],
      parentId: input.parentId ?? null,
      linkedAssetId: input.linkedAssetId ?? null,
      ratings: [],
      createdAt: now,
      updatedAt: now,
    })
    await this.writeEntries(dir, kind, entries)
    await touchProject(dir)
    return sortByCreatedDesc(entries)
  }

  async updateEntry(
    projectId: string,
    kind: PromptLabKind,
    entryId: string,
    updates: PromptEntryUpdates,
  ): Promise<PromptEntry[]> {
    const dir = await requireProjectDir(projectId)
    const entries = await this.readEntries(dir, kind)
    const entry = entries.find((e) => e.id === entryId)
    if (!entry) throw new Error('Prompt entry not found.')

    if (updates.promptText !== undefined) {
      const trimmed = updates.promptText.trim()
      if (!trimmed) throw new Error('Prompt text cannot be empty.')
      entry.promptText = trimmed
    }
    if (updates.lyrics !== undefined) entry.lyrics = updates.lyrics
    if (updates.settings !== undefined) entry.settings = updates.settings
    if (updates.notes !== undefined) entry.notes = updates.notes
    if (updates.tags !== undefined) entry.tags = updates.tags
    if (updates.linkedAssetId !== undefined) entry.linkedAssetId = updates.linkedAssetId
    entry.updatedAt = new Date().toISOString()

    await this.writeEntries(dir, kind, entries)
    await touchProject(dir)
    return sortByCreatedDesc(entries)
  }

  /**
   * Deletes a prompt entry. Any entries that were versioned off of it have
   * their `parentId` cleared (they become roots of their own chain) rather
   * than being cascade-deleted — losing a whole branch of prompt history
   * because an earlier version was cleaned up would be too destructive for
   * what's meant to be a durable history log.
   */
  async deleteEntry(projectId: string, kind: PromptLabKind, entryId: string): Promise<PromptEntry[]> {
    const dir = await requireProjectDir(projectId)
    const entries = await this.readEntries(dir, kind)
    if (!entries.some((e) => e.id === entryId)) throw new Error('Prompt entry not found.')

    const remaining = entries.filter((e) => e.id !== entryId)
    for (const e of remaining) {
      if (e.parentId === entryId) e.parentId = null
    }
    await this.writeEntries(dir, kind, remaining)
    await touchProject(dir)
    return sortByCreatedDesc(remaining)
  }

  // --- Ratings --------------------------------------------------------------
  //
  // A prompt entry can produce multiple generated clips/takes; each is
  // rated separately (per-clip ratings), scored across that lab's fixed
  // dimensions (electron/promptLabTypes.ts).

  async addRating(
    projectId: string,
    kind: PromptLabKind,
    entryId: string,
    input: RatingInput,
  ): Promise<PromptEntry[]> {
    const trimmedLabel = input.clipLabel.trim()
    if (!trimmedLabel) throw new Error('Clip label cannot be empty.')

    const dir = await requireProjectDir(projectId)
    const entries = await this.readEntries(dir, kind)
    const entry = entries.find((e) => e.id === entryId)
    if (!entry) throw new Error('Prompt entry not found.')

    const now = new Date().toISOString()
    entry.ratings.push({
      id: randomUUID(),
      clipLabel: trimmedLabel,
      linkedAssetId: input.linkedAssetId ?? null,
      scores: sanitizeScores(kind, input.scores),
      notes: input.notes ?? '',
      createdAt: now,
    })
    entry.updatedAt = now

    await this.writeEntries(dir, kind, entries)
    await touchProject(dir)
    return sortByCreatedDesc(entries)
  }

  async updateRating(
    projectId: string,
    kind: PromptLabKind,
    entryId: string,
    ratingId: string,
    updates: RatingUpdates,
  ): Promise<PromptEntry[]> {
    const dir = await requireProjectDir(projectId)
    const entries = await this.readEntries(dir, kind)
    const entry = entries.find((e) => e.id === entryId)
    if (!entry) throw new Error('Prompt entry not found.')
    const rating = entry.ratings.find((r) => r.id === ratingId)
    if (!rating) throw new Error('Rating not found.')

    if (updates.clipLabel !== undefined) {
      const trimmed = updates.clipLabel.trim()
      if (!trimmed) throw new Error('Clip label cannot be empty.')
      rating.clipLabel = trimmed
    }
    if (updates.linkedAssetId !== undefined) rating.linkedAssetId = updates.linkedAssetId
    if (updates.scores !== undefined) rating.scores = sanitizeScores(kind, updates.scores)
    if (updates.notes !== undefined) rating.notes = updates.notes
    entry.updatedAt = new Date().toISOString()

    await this.writeEntries(dir, kind, entries)
    await touchProject(dir)
    return sortByCreatedDesc(entries)
  }

  async deleteRating(
    projectId: string,
    kind: PromptLabKind,
    entryId: string,
    ratingId: string,
  ): Promise<PromptEntry[]> {
    const dir = await requireProjectDir(projectId)
    const entries = await this.readEntries(dir, kind)
    const entry = entries.find((e) => e.id === entryId)
    if (!entry) throw new Error('Prompt entry not found.')
    if (!entry.ratings.some((r) => r.id === ratingId)) throw new Error('Rating not found.')

    entry.ratings = entry.ratings.filter((r) => r.id !== ratingId)
    entry.updatedAt = new Date().toISOString()

    await this.writeEntries(dir, kind, entries)
    await touchProject(dir)
    return sortByCreatedDesc(entries)
  }

  // --- Recipes ----------------------------------------------------------
  //
  // A recipe is a named, reusable snapshot of wording that worked —
  // promoted from a history entry (or written from scratch) so it can be
  // reused as the starting point for a new entry later without digging
  // back through history.

  async listRecipes(projectId: string, kind: PromptLabKind): Promise<Recipe[]> {
    const dir = await requireProjectDir(projectId)
    return sortByCreatedDesc(await this.readRecipes(dir, kind))
  }

  async promoteToRecipe(
    projectId: string,
    kind: PromptLabKind,
    entryId: string,
    name: string,
  ): Promise<Recipe[]> {
    const trimmedName = name.trim()
    if (!trimmedName) throw new Error('Recipe name cannot be empty.')

    const dir = await requireProjectDir(projectId)
    const entries = await this.readEntries(dir, kind)
    const entry = entries.find((e) => e.id === entryId)
    if (!entry) throw new Error('Prompt entry not found.')

    const recipes = await this.readRecipes(dir, kind)
    const now = new Date().toISOString()
    recipes.push({
      id: randomUUID(),
      kind,
      name: trimmedName,
      promptText: entry.promptText,
      lyrics: entry.lyrics,
      settings: entry.settings,
      notes: entry.notes,
      tags: entry.tags,
      sourceEntryId: entry.id,
      createdAt: now,
      updatedAt: now,
    })
    await this.writeRecipes(dir, kind, recipes)
    await touchProject(dir)
    return sortByCreatedDesc(recipes)
  }

  async updateRecipe(
    projectId: string,
    kind: PromptLabKind,
    recipeId: string,
    updates: { name?: string; promptText?: string; lyrics?: string; settings?: string; notes?: string; tags?: string[] },
  ): Promise<Recipe[]> {
    const dir = await requireProjectDir(projectId)
    const recipes = await this.readRecipes(dir, kind)
    const recipe = recipes.find((r) => r.id === recipeId)
    if (!recipe) throw new Error('Recipe not found.')

    if (updates.name !== undefined) {
      const trimmed = updates.name.trim()
      if (!trimmed) throw new Error('Recipe name cannot be empty.')
      recipe.name = trimmed
    }
    if (updates.promptText !== undefined) recipe.promptText = updates.promptText
    if (updates.lyrics !== undefined) recipe.lyrics = updates.lyrics
    if (updates.settings !== undefined) recipe.settings = updates.settings
    if (updates.notes !== undefined) recipe.notes = updates.notes
    if (updates.tags !== undefined) recipe.tags = updates.tags
    recipe.updatedAt = new Date().toISOString()

    await this.writeRecipes(dir, kind, recipes)
    await touchProject(dir)
    return sortByCreatedDesc(recipes)
  }

  async deleteRecipe(projectId: string, kind: PromptLabKind, recipeId: string): Promise<Recipe[]> {
    const dir = await requireProjectDir(projectId)
    const recipes = await this.readRecipes(dir, kind)
    if (!recipes.some((r) => r.id === recipeId)) throw new Error('Recipe not found.')

    const remaining = recipes.filter((r) => r.id !== recipeId)
    await this.writeRecipes(dir, kind, remaining)
    await touchProject(dir)
    return sortByCreatedDesc(remaining)
  }

  // --- Storage --------------------------------------------------------------

  private async readEntries(dir: string, kind: PromptLabKind): Promise<PromptEntry[]> {
    return readJsonFile<PromptEntry[]>(promptsPath(dir, kind), [])
  }

  private async writeEntries(dir: string, kind: PromptLabKind, entries: PromptEntry[]): Promise<void> {
    await writeJsonFile(promptsPath(dir, kind), entries)
  }

  private async readRecipes(dir: string, kind: PromptLabKind): Promise<Recipe[]> {
    return readJsonFile<Recipe[]>(recipesPath(dir, kind), [])
  }

  private async writeRecipes(dir: string, kind: PromptLabKind, recipes: Recipe[]): Promise<void> {
    await writeJsonFile(recipesPath(dir, kind), recipes)
  }
}
