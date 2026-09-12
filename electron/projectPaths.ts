import { app } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { readJsonFile, writeJsonFile } from './fsUtils'

// Shared project-folder resolution, used by both projectManager.ts (projects
// and assets) and productionManager.ts (script/scenes/shots) so there's one
// place that knows how a project id maps to a folder on disk.

export interface ProjectMeta {
  id: string
  name: string
  createdAt: string
  updatedAt: string
}

/** Root folder all projects live under: <Documents>/Dan's Video Studio/Projects */
export function projectsRoot(): string {
  return path.join(app.getPath('documents'), "Dan's Video Studio", 'Projects')
}

export async function ensureProjectsRoot(): Promise<string> {
  const root = projectsRoot()
  await fs.mkdir(root, { recursive: true })
  return root
}

export async function readProjectMeta(dir: string): Promise<ProjectMeta | null> {
  return readJsonFile<ProjectMeta | null>(path.join(dir, 'project.json'), null)
}

export async function writeProjectMeta(dir: string, meta: ProjectMeta): Promise<void> {
  await writeJsonFile(path.join(dir, 'project.json'), meta)
}

/** Bumps a project's updatedAt to now — call after any change to its contents. */
export async function touchProject(dir: string): Promise<void> {
  const meta = await readProjectMeta(dir)
  if (meta) await writeProjectMeta(dir, { ...meta, updatedAt: new Date().toISOString() })
}

/** Resolve a project id to its folder path, or null if not found. */
export async function findProjectDir(id: string): Promise<string | null> {
  const root = await ensureProjectsRoot()
  const entries = await fs.readdir(root, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const dir = path.join(root, entry.name)
    const meta = await readProjectMeta(dir)
    if (meta?.id === id) return dir
  }
  return null
}

/** Resolve a project id to its folder path, throwing if not found. */
export async function requireProjectDir(id: string): Promise<string> {
  const dir = await findProjectDir(id)
  if (!dir) throw new Error('Project not found.')
  return dir
}
