import { promises as fs } from 'node:fs'
import path from 'node:path'
import { requireProjectDir } from './projectPaths'
import { ProjectManager, type Asset } from './projectManager'
import { ProductionManager } from './productionManager'
import { PromptLabManager } from './promptLabManager'
import { SfxLibraryManager } from './sfxLibraryManager'
import { PROMPT_LAB_KINDS, PROMPT_LAB_LABELS } from './promptLabTypes'

// --- Phase 5: Media Management -----------------------------------------
//
// Deliberately not a new storage subsystem — every piece of data surfaced
// here already lives in one of the existing managers: ProjectManager's
// assets.json (the actual video/image/audio/other files), ProductionManager's
// shots.json (`linkedAssetId`), PromptLabManager's per-kind prompt/rating
// history (`linkedAssetId` on both entries and ratings), and
// SfxLibraryManager's sfxLibrary.json (`linkedAssetId`). This manager's only
// job is cross-referencing all four into one unified, searchable view per
// asset — "what is this, and where is it actually used" — so Dan doesn't
// have to go check five separate tabs to find out whether an asset is still
// needed, or to find the SFX/rating/shot that used it. It's read-only: it
// has no JSON file of its own and nothing here can be deleted/edited except
// by going to the tab that actually owns that data.
//
// Also surfaces `exports/` (Phase 6/7's export output folder) as a plain
// file listing, since it's part of the same "everything this project has
// produced" picture even though nothing writes into it yet.

export interface MediaUsage {
  type: 'shot' | 'promptEntry' | 'promptRating' | 'sfx'
  /** Short label for where this usage lives, e.g. a lab name or "Scene 1 → Shot 2". */
  label: string
  /** A bit more detail — the shot's status, a prompt preview, a clip label, etc. */
  detail: string
}

export interface MediaLibraryEntry extends Asset {
  usages: MediaUsage[]
  /** From a linked SFX library entry, if any — folded in so SFX tags/license are searchable here too. */
  sfxTags: string[]
  sfxLicense: string | null
}

export interface ExportFile {
  name: string
  sizeBytes: number
  modifiedAt: string
}

export class MediaLibraryManager {
  constructor(
    private projects: ProjectManager,
    private production: ProductionManager,
    private promptLab: PromptLabManager,
    private sfxLibrary: SfxLibraryManager,
  ) {}

  async getLibrary(projectId: string): Promise<MediaLibraryEntry[]> {
    const [assets, scenes, shots, sfxEntries, promptEntriesByKind] = await Promise.all([
      this.projects.listAssets(projectId),
      this.production.listScenes(projectId),
      this.production.listShots(projectId),
      this.sfxLibrary.listEntries(projectId),
      Promise.all(PROMPT_LAB_KINDS.map((kind) => this.promptLab.listEntries(projectId, kind))),
    ])

    const sceneTitleById = new Map(scenes.map((s) => [s.id, s.title]))

    return assets.map((asset) => {
      const usages: MediaUsage[] = []

      for (const shot of shots) {
        if (shot.linkedAssetId !== asset.id) continue
        const sceneTitle = sceneTitleById.get(shot.sceneId) ?? 'Unknown scene'
        usages.push({ type: 'shot', label: `${sceneTitle} → ${shot.title}`, detail: `Shot status: ${shot.status}` })
      }

      PROMPT_LAB_KINDS.forEach((kind, i) => {
        for (const entry of promptEntriesByKind[i]) {
          if (entry.linkedAssetId === asset.id) {
            usages.push({
              type: 'promptEntry',
              label: PROMPT_LAB_LABELS[kind],
              detail: entry.promptText.length > 80 ? `${entry.promptText.slice(0, 80)}…` : entry.promptText,
            })
          }
          for (const rating of entry.ratings) {
            if (rating.linkedAssetId === asset.id) {
              usages.push({
                type: 'promptRating',
                label: `${PROMPT_LAB_LABELS[kind]} rating`,
                detail: rating.clipLabel,
              })
            }
          }
        }
      })

      const sfxEntry = sfxEntries.find((e) => e.linkedAssetId === asset.id)
      if (sfxEntry) {
        usages.push({ type: 'sfx', label: 'SFX Library', detail: sfxEntry.name })
      }

      return {
        ...asset,
        usages,
        sfxTags: sfxEntry?.tags ?? [],
        sfxLicense: sfxEntry?.license || null,
      }
    })
  }

  /** Plain listing of whatever's in the project's exports/ folder — Phase 6/7 populate it, this just reports what's there. */
  async listExports(projectId: string): Promise<ExportFile[]> {
    const dir = await requireProjectDir(projectId)
    const exportsDir = path.join(dir, 'exports')

    let names: string[]
    try {
      names = await fs.readdir(exportsDir)
    } catch {
      return []
    }

    const files: ExportFile[] = []
    for (const name of names) {
      const stat = await fs.stat(path.join(exportsDir, name))
      if (!stat.isFile()) continue
      files.push({ name, sizeBytes: stat.size, modifiedAt: stat.mtime.toISOString() })
    }
    files.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
    return files
  }
}
