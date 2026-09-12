import { promises as fs } from 'node:fs'
import path from 'node:path'

/** Whether a path exists on disk, regardless of file/directory. */
export async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

/** Reads and JSON-parses a file, returning `fallback` if it's missing or unparseable. */
export async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8')
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export async function writeJsonFile(filePath: string, data: unknown): Promise<void> {
  // mkdir first (recursive + idempotent) so callers can write into a
  // subfolder that didn't exist yet — e.g. a project created before a later
  // phase added a new data folder (see promptLabManager.ts/
  // sfxLibraryManager.ts) — without every manager repeating the same mkdir.
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8')
}
