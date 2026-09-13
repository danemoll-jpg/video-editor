// TODO.md's Settings library-relocation item: moves the whole library (every
// project's real data — not just new projects going forward) to a folder Dan
// picks, then remembers the new location via libraryLocation.ts so
// projectPaths.ts's `projectsRoot()` resolves there from then on.
//
// The move itself prefers a plain `fs.rename` (instant, atomic) and only
// falls back to a recursive copy-then-delete when that fails — which is
// exactly the case where the source and destination are on different
// drives, where a rename can't work at the filesystem level.

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { pathExists } from './fsUtils'
import { defaultLibraryBaseDir, getLibraryBaseDir, setLibraryBaseDir } from './libraryLocation'

async function copyRecursive(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true })
  const entries = await fs.readdir(src, { withFileTypes: true })
  for (const entry of entries) {
    const s = path.join(src, entry.name)
    const d = path.join(dest, entry.name)
    if (entry.isDirectory()) await copyRecursive(s, d)
    else await fs.copyFile(s, d)
  }
}

export interface LibraryLocation {
  baseDir: string
  isDefault: boolean
}

export class LibraryRelocationManager {
  async getCurrentLocation(): Promise<LibraryLocation> {
    const baseDir = await getLibraryBaseDir()
    return { baseDir, isDefault: path.resolve(baseDir) === path.resolve(defaultLibraryBaseDir()) }
  }

  /**
   * Moves every existing project's data from the current library location
   * into `<chosenParentDir>/Dan's Video Studio`, then remembers the new
   * location. A real migration, not just pointing new projects at an empty
   * folder — nothing already on disk is left behind or duplicated.
   */
  async relocateLibrary(chosenParentDir: string): Promise<LibraryLocation> {
    const oldBaseDir = await getLibraryBaseDir()
    const newBaseDir = path.join(chosenParentDir, "Dan's Video Studio")

    if (path.resolve(oldBaseDir) === path.resolve(newBaseDir)) {
      return { baseDir: newBaseDir, isDefault: path.resolve(newBaseDir) === path.resolve(defaultLibraryBaseDir()) }
    }
    if (await pathExists(newBaseDir)) {
      throw new Error(
        `"${chosenParentDir}" already has a "Dan's Video Studio" folder in it. Choose a different destination.`,
      )
    }

    if (await pathExists(oldBaseDir)) {
      try {
        await fs.rename(oldBaseDir, newBaseDir)
      } catch {
        // Cross-device (e.g. a different drive) — fs.rename can't do an
        // atomic move there, so fall back to copy-then-delete-the-original.
        await copyRecursive(oldBaseDir, newBaseDir)
        await fs.rm(oldBaseDir, { recursive: true, force: true })
      }
    } else {
      await fs.mkdir(newBaseDir, { recursive: true })
    }

    await setLibraryBaseDir(newBaseDir)
    return { baseDir: newBaseDir, isDefault: path.resolve(newBaseDir) === path.resolve(defaultLibraryBaseDir()) }
  }
}
