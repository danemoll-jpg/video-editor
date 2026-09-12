import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { readJsonFile, writeJsonFile } from './fsUtils'
import { requireProjectDir, touchProject } from './projectPaths'

// --- Data model -------------------------------------------------------
//
// The fourth Phase 3 subsystem, but a different shape from the three
// "prompt lab" ones (see promptLabManager.ts): this isn't prompt history to
// rate and version, it's a tagged library of free-source SFX assets with
// license/attribution tracking, so it doesn't need ratings, recipes, or a
// parentId version chain.
//
// Stored at `promptlab/sfxLibrary.json` (see projectManager.ts for the
// project folder layout). Each entry is metadata *about* an SFX file —
// where it came from, its license, required attribution — and optionally
// points at `linkedAssetId`, the id of the actual audio file once it's been
// brought in via the existing Phase 1 asset import (projectManager.ts:
// `assets/audio/...`). This deliberately reuses the existing asset storage
// instead of duplicating a second file-storage mechanism: import the SFX
// file normally via "Import Assets", then add/link a library entry here
// with its tags, source, and license.

export interface SfxLibraryEntry {
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

export interface SfxLibraryEntryInput {
  name: string
  tags?: string[]
  sourceUrl?: string
  license?: string
  attribution?: string
  linkedAssetId?: string | null
  notes?: string
}

export interface SfxLibraryEntryUpdates {
  name?: string
  tags?: string[]
  sourceUrl?: string
  license?: string
  attribution?: string
  linkedAssetId?: string | null
  notes?: string
}

function sfxPath(dir: string): string {
  return path.join(dir, 'promptlab', 'sfxLibrary.json')
}

function sortByName<T extends { name: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.name.localeCompare(b.name))
}

export class SfxLibraryManager {
  async listEntries(projectId: string): Promise<SfxLibraryEntry[]> {
    const dir = await requireProjectDir(projectId)
    return sortByName(await this.readEntries(dir))
  }

  async createEntry(projectId: string, input: SfxLibraryEntryInput): Promise<SfxLibraryEntry[]> {
    const trimmed = input.name.trim()
    if (!trimmed) throw new Error('SFX name cannot be empty.')

    const dir = await requireProjectDir(projectId)
    const entries = await this.readEntries(dir)
    const now = new Date().toISOString()
    entries.push({
      id: randomUUID(),
      name: trimmed,
      tags: input.tags ?? [],
      sourceUrl: input.sourceUrl ?? '',
      license: input.license ?? '',
      attribution: input.attribution ?? '',
      linkedAssetId: input.linkedAssetId ?? null,
      notes: input.notes ?? '',
      createdAt: now,
      updatedAt: now,
    })
    await this.writeEntries(dir, entries)
    await touchProject(dir)
    return sortByName(entries)
  }

  async updateEntry(
    projectId: string,
    sfxId: string,
    updates: SfxLibraryEntryUpdates,
  ): Promise<SfxLibraryEntry[]> {
    const dir = await requireProjectDir(projectId)
    const entries = await this.readEntries(dir)
    const entry = entries.find((e) => e.id === sfxId)
    if (!entry) throw new Error('SFX library entry not found.')

    if (updates.name !== undefined) {
      const trimmed = updates.name.trim()
      if (!trimmed) throw new Error('SFX name cannot be empty.')
      entry.name = trimmed
    }
    if (updates.tags !== undefined) entry.tags = updates.tags
    if (updates.sourceUrl !== undefined) entry.sourceUrl = updates.sourceUrl
    if (updates.license !== undefined) entry.license = updates.license
    if (updates.attribution !== undefined) entry.attribution = updates.attribution
    if (updates.linkedAssetId !== undefined) entry.linkedAssetId = updates.linkedAssetId
    if (updates.notes !== undefined) entry.notes = updates.notes
    entry.updatedAt = new Date().toISOString()

    await this.writeEntries(dir, entries)
    await touchProject(dir)
    return sortByName(entries)
  }

  async deleteEntry(projectId: string, sfxId: string): Promise<SfxLibraryEntry[]> {
    const dir = await requireProjectDir(projectId)
    const entries = await this.readEntries(dir)
    if (!entries.some((e) => e.id === sfxId)) throw new Error('SFX library entry not found.')

    const remaining = entries.filter((e) => e.id !== sfxId)
    await this.writeEntries(dir, remaining)
    await touchProject(dir)
    return sortByName(remaining)
  }

  private async readEntries(dir: string): Promise<SfxLibraryEntry[]> {
    return readJsonFile<SfxLibraryEntry[]>(sfxPath(dir), [])
  }

  private async writeEntries(dir: string, entries: SfxLibraryEntry[]): Promise<void> {
    await writeJsonFile(sfxPath(dir), entries)
  }
}
