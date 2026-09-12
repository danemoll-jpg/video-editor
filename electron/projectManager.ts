import { app, shell } from 'electron'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

// --- Data model -------------------------------------------------------
//
// Projects live on disk under `projectsRoot()`, one folder per project:
//
//   <slug>-<shortId>/
//     project.json      metadata: id, name, createdAt, updatedAt
//     assets.json        index of imported assets (see Asset below)
//     assets/
//       video/  image/  audio/  other/
//     script/            placeholder for Phase 2 (scripts/scenes/shots)
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

export interface ProjectMeta {
  id: string
  name: string
  createdAt: string
  updatedAt: string
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

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

export class ProjectManager {
  /** Root folder all projects live under: <Documents>/Dan Video Studio/Projects */
  private root(): string {
    return path.join(app.getPath('documents'), 'Dan Video Studio', 'Projects')
  }

  private async ensureRoot(): Promise<string> {
    const root = this.root()
    await fs.mkdir(root, { recursive: true })
    return root
  }

  private async readMeta(dir: string): Promise<ProjectMeta | null> {
    try {
      const raw = await fs.readFile(path.join(dir, 'project.json'), 'utf-8')
      return JSON.parse(raw) as ProjectMeta
    } catch {
      return null
    }
  }

  private async writeMeta(dir: string, meta: ProjectMeta): Promise<void> {
    await fs.writeFile(path.join(dir, 'project.json'), JSON.stringify(meta, null, 2), 'utf-8')
  }

  private async readAssets(dir: string): Promise<Asset[]> {
    try {
      const raw = await fs.readFile(path.join(dir, 'assets.json'), 'utf-8')
      return JSON.parse(raw) as Asset[]
    } catch {
      return []
    }
  }

  private async writeAssets(dir: string, assets: Asset[]): Promise<void> {
    await fs.writeFile(path.join(dir, 'assets.json'), JSON.stringify(assets, null, 2), 'utf-8')
  }

  /** Resolve a project id to its folder path, or null if not found. */
  private async findProjectDir(id: string): Promise<string | null> {
    const root = await this.ensureRoot()
    const entries = await fs.readdir(root, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const dir = path.join(root, entry.name)
      const meta = await this.readMeta(dir)
      if (meta?.id === id) return dir
    }
    return null
  }

  async listProjects(): Promise<ProjectSummary[]> {
    const root = await this.ensureRoot()
    const entries = await fs.readdir(root, { withFileTypes: true })
    const summaries: ProjectSummary[] = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const dir = path.join(root, entry.name)
      const meta = await this.readMeta(dir)
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

    const root = await this.ensureRoot()
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

    const now = new Date().toISOString()
    const meta: ProjectMeta = { id, name: trimmed, createdAt: now, updatedAt: now }
    await this.writeMeta(dir, meta)
    await this.writeAssets(dir, [])

    return { ...meta, path: dir, assetCount: 0 }
  }

  async getProject(id: string): Promise<ProjectSummary | null> {
    const dir = await this.findProjectDir(id)
    if (!dir) return null
    const meta = await this.readMeta(dir)
    if (!meta) return null
    const assets = await this.readAssets(dir)
    return { ...meta, path: dir, assetCount: assets.length }
  }

  /** Moves the project folder to the OS trash (recoverable), not a permanent delete. */
  async deleteProject(id: string): Promise<void> {
    const dir = await this.findProjectDir(id)
    if (!dir) throw new Error('Project not found.')
    await shell.trashItem(dir)
  }

  async openProjectFolder(id: string): Promise<void> {
    const dir = await this.findProjectDir(id)
    if (!dir) throw new Error('Project not found.')
    await shell.openPath(dir)
  }

  async listAssets(projectId: string): Promise<Asset[]> {
    const dir = await this.findProjectDir(projectId)
    if (!dir) throw new Error('Project not found.')
    return this.readAssets(dir)
  }

  async importAssets(projectId: string, filePaths: string[]): Promise<Asset[]> {
    const dir = await this.findProjectDir(projectId)
    if (!dir) throw new Error('Project not found.')

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
    const meta = await this.readMeta(dir)
    if (meta) await this.writeMeta(dir, { ...meta, updatedAt: new Date().toISOString() })

    return assets
  }

  async deleteAsset(projectId: string, assetId: string): Promise<Asset[]> {
    const dir = await this.findProjectDir(projectId)
    if (!dir) throw new Error('Project not found.')

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
}
