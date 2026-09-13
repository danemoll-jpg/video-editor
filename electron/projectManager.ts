import { shell } from 'electron'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { pathExists, readJsonFile, writeJsonFile } from './fsUtils'
import {
  ensureProjectsRoot,
  findProjectDir,
  readProjectMeta,
  requireProjectDir,
  touchProject,
  writeProjectMeta,
  type ProjectMeta,
} from './projectPaths'
import { probeMedia } from './mediaProbe'
import { extractAudioTrack } from './audioExtractor'

// --- Data model -------------------------------------------------------
//
// Projects live on disk under `projectsRoot()` (see projectPaths.ts), one
// folder per project:
//
//   <slug>-<shortId>/
//     project.json      metadata: id, name, createdAt, updatedAt
//     assets.json        index of imported assets (see Asset below)
//     assets/
//       video/  image/  audio/  other/
//     script/            script/scenes/shots — see productionManager.ts
//     promptlab/         Grok/Suno/ElevenLabs prompt labs + SFX library —
//                         see promptLabManager.ts and sfxLibraryManager.ts
//     exports/           placeholder for Phase 6 (export tools)
//
// Imported files are copied in under a generated id-based filename
// (`<assetId><ext>`) so collisions and manual versioned names
// (final_v2_FINAL...) are impossible by construction. The user-facing
// display name (`originalName`) is preserved in assets.json.

export type AssetKind = 'video' | 'image' | 'audio' | 'other'

export interface Asset {
  id: string
  originalName: string
  storedFileName: string
  kind: AssetKind
  sizeBytes: number
  importedAt: string
  relativePath: string
}

export interface ProjectSummary extends ProjectMeta {
  path: string
  assetCount: number
}

const EXT_KIND: Record<string, AssetKind> = {
  '.mp4': 'video',
  '.mov': 'video',
  '.mkv': 'video',
  '.webm': 'video',
  '.avi': 'video',
  '.m4v': 'video',
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.gif': 'image',
  '.webp': 'image',
  '.bmp': 'image',
  '.wav': 'audio',
  '.mp3': 'audio',
  '.m4a': 'audio',
  '.aac': 'audio',
  '.flac': 'audio',
  '.ogg': 'audio',
}

const ASSET_KINDS: AssetKind[] = ['video', 'image', 'audio', 'other']

function detectKind(ext: string): AssetKind {
  return EXT_KIND[ext.toLowerCase()] ?? 'other'
}

function slugify(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-+|-+$)/g, '')
  return slug || 'project'
}

export class ProjectManager {
  async listProjects(): Promise<ProjectSummary[]> {
    const root = await ensureProjectsRoot()
    const entries = await fs.readdir(root, { withFileTypes: true })
    const summaries: ProjectSummary[] = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const dir = path.join(root, entry.name)
      const meta = await readProjectMeta(dir)
      if (!meta) continue
      const assets = await this.readAssets(dir)
      summaries.push({ ...meta, path: dir, assetCount: assets.length })
    }
    summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    return summaries
  }

  async createProject(name: string): Promise<ProjectSummary> {
    const trimmed = name.trim()
    if (!trimmed) throw new Error('Project name cannot be empty.')

    const root = await ensureProjectsRoot()
    const id = randomUUID()
    const dirName = `${slugify(trimmed)}-${id.slice(0, 8)}`
    const dir = path.join(root, dirName)

    if (await pathExists(dir)) {
      throw new Error('A project folder with this name already exists. Try a different name.')
    }

    for (const kind of ASSET_KINDS) {
      await fs.mkdir(path.join(dir, 'assets', kind), { recursive: true })
    }
    await fs.mkdir(path.join(dir, 'script'), { recursive: true })
    await fs.mkdir(path.join(dir, 'exports'), { recursive: true })
    await fs.mkdir(path.join(dir, 'promptlab'), { recursive: true })

    const now = new Date().toISOString()
    const meta: ProjectMeta = { id, name: trimmed, createdAt: now, updatedAt: now }
    await writeProjectMeta(dir, meta)
    await this.writeAssets(dir, [])

    return { ...meta, path: dir, assetCount: 0 }
  }

  async getProject(id: string): Promise<ProjectSummary | null> {
    const dir = await findProjectDir(id)
    if (!dir) return null
    const meta = await readProjectMeta(dir)
    if (!meta) return null
    const assets = await this.readAssets(dir)
    return { ...meta, path: dir, assetCount: assets.length }
  }

  /** Moves the project folder to the OS trash (recoverable), not a permanent delete. */
  async deleteProject(id: string): Promise<void> {
    const dir = await requireProjectDir(id)
    await shell.trashItem(dir)
  }

  async openProjectFolder(id: string): Promise<void> {
    const dir = await requireProjectDir(id)
    await shell.openPath(dir)
  }

  async listAssets(projectId: string): Promise<Asset[]> {
    const dir = await requireProjectDir(projectId)
    return this.readAssets(dir)
  }

  /**
   * Absolute on-disk path for one asset — added for Phase 6 (editorManager.ts/
   * videoExportManager.ts need the real file to play/encode, not just the
   * asset record). Every other manager only ever needed the relative record.
   */
  async getAssetAbsolutePath(projectId: string, assetId: string): Promise<string> {
    const dir = await requireProjectDir(projectId)
    const assets = await this.readAssets(dir)
    const asset = assets.find((a) => a.id === assetId)
    if (!asset) throw new Error('Asset not found.')
    return path.join(dir, asset.relativePath)
  }

  async importAssets(projectId: string, filePaths: string[]): Promise<Asset[]> {
    const dir = await requireProjectDir(projectId)

    const assets = await this.readAssets(dir)

    for (const srcPath of filePaths) {
      const ext = path.extname(srcPath)
      const kind = detectKind(ext)
      const stat = await fs.stat(srcPath)
      const assetId = randomUUID()
      const storedFileName = `${assetId}${ext.toLowerCase()}`
      const relativePath = path.join('assets', kind, storedFileName)
      await fs.copyFile(srcPath, path.join(dir, relativePath))

      assets.push({
        id: assetId,
        originalName: path.basename(srcPath),
        storedFileName,
        kind,
        sizeBytes: stat.size,
        importedAt: new Date().toISOString(),
        relativePath,
      })
    }

    await this.writeAssets(dir, assets)
    await touchProject(dir)

    return assets
  }

  async deleteAsset(projectId: string, assetId: string): Promise<Asset[]> {
    const dir = await requireProjectDir(projectId)

    const assets = await this.readAssets(dir)
    const target = assets.find((a) => a.id === assetId)
    if (!target) throw new Error('Asset not found.')

    const filePath = path.join(dir, target.relativePath)
    if (await pathExists(filePath)) {
      await shell.trashItem(filePath)
    }

    const remaining = assets.filter((a) => a.id !== assetId)
    await this.writeAssets(dir, remaining)
    return remaining
  }

  /**
   * Pulls a video asset's audio track out into a real new standalone audio
   * asset (TODO.md's audio-extraction item 1) — added to `assets/audio/` and
   * `assets.json` exactly like any imported file, so it can be linked to a
   * shot, a scene's songs, an SFX entry, or dragged onto an editor audio
   * track like any other audio asset. (Extracting a *timeline clip's* audio
   * onto its own audio-track clip, item 2, is a different operation — see
   * `EditorManager.extractClipAudio`, which doesn't need a new file at all.)
   */
  async extractAudioAsset(projectId: string, assetId: string): Promise<Asset[]> {
    const dir = await requireProjectDir(projectId)
    const assets = await this.readAssets(dir)
    const source = assets.find((a) => a.id === assetId)
    if (!source) throw new Error('Asset not found.')
    if (source.kind !== 'video') throw new Error('Only video assets have an audio track to extract.')

    const sourcePath = path.join(dir, source.relativePath)
    const info = await probeMedia(sourcePath).catch(() => null)
    if (!info?.hasAudio) throw new Error('This video has no audio track to extract.')

    const newId = randomUUID()
    const storedFileName = `${newId}.m4a`
    const relativePath = path.join('assets', 'audio', storedFileName)
    await extractAudioTrack(sourcePath, path.join(dir, relativePath))
    const stat = await fs.stat(path.join(dir, relativePath))

    const baseName = path.basename(source.originalName, path.extname(source.originalName))
    const newAsset: Asset = {
      id: newId,
      originalName: `${baseName} (audio).m4a`,
      storedFileName,
      kind: 'audio',
      sizeBytes: stat.size,
      importedAt: new Date().toISOString(),
      relativePath,
    }

    const updated = [...assets, newAsset]
    await this.writeAssets(dir, updated)
    await touchProject(dir)
    return updated
  }

  private async readAssets(dir: string): Promise<Asset[]> {
    return readJsonFile<Asset[]>(path.join(dir, 'assets.json'), [])
  }

  private async writeAssets(dir: string, assets: Asset[]): Promise<void> {
    await writeJsonFile(path.join(dir, 'assets.json'), assets)
  }
}
