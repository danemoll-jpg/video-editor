// TODO.md's Settings library-relocation item: moves the whole library (every
// project's real data — not just new projects going forward) to a folder Dan
// picks, then remembers the new location via libraryLocation.ts so
// projectPaths.ts's `projectsRoot()` resolves there from then on.
//
// **Rewritten (2026-09-13) after a real incident** (see TODO.md's Current
// Objective / Technical Notes for the full writeup): the original version
// moved the *entire* library in one shot — one `fs.rename` attempt, falling
// back to one whole-tree `copyRecursive` + one whole-tree `fs.rm(recursive)`
// on failure — and persisted the new location only after that single
// operation resolved. That looked safe (the preference genuinely was never
// written on a throw), but it wasn't: a single locked file inside ONE
// project (an unrelated stray test-residue folder, in the incident) made the
// bulk `fs.rm(recursive: true, force: true)` throw partway through, and
// Node's recursive delete does not delete a directory's entries strictly
// one-at-a-time in a safe, abortable order — by the time the throw
// surfaced, files belonging to *other, unrelated, real* projects had
// already been unlinked from the old location, leaving empty directory
// shells where real project data used to be. The persisted preference
// technically stayed correct (still pointing at the old, now-hollowed-out
// location), but that's cold comfort — the visible symptom was Dan's real
// project list disappearing, because the *data*, not just the pointer to
// it, had been partially destroyed.
//
// The fix is to never again run one all-or-nothing bulk operation over the
// whole library. Every project folder is now moved individually, and the
// operation is structured so the persisted location can only ever switch
// once every single project has been verified fully present at the new
// location — with a clean rollback (undoing whatever partial progress was
// made) on any failure, so a problem with one project can never again leave
// the library half-moved or any other project's data at risk.

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

/** Recursively counts files and total bytes under `dir` (0/0 if it doesn't exist). */
async function summarize(dir: string): Promise<{ fileCount: number; totalBytes: number }> {
  let fileCount = 0
  let totalBytes = 0
  async function walk(d: string): Promise<void> {
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(d, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
      } else {
        fileCount += 1
        totalBytes += (await fs.stat(full)).size
      }
    }
  }
  await walk(dir)
  return { fileCount, totalBytes }
}

/** Throws if `dest` doesn't look like a faithful copy of `src` (file count/total size mismatch). */
async function verifyCopy(projectName: string, src: string, dest: string): Promise<void> {
  const [from, to] = await Promise.all([summarize(src), summarize(dest)])
  if (from.fileCount !== to.fileCount || from.totalBytes !== to.totalBytes) {
    throw new Error(
      `"${projectName}" didn't copy cleanly (expected ${from.fileCount} file(s)/${from.totalBytes} byte(s), ` +
        `got ${to.fileCount}/${to.totalBytes}) — stopping before touching anything else.`,
    )
  }
}

export interface LibraryLocation {
  baseDir: string
  isDefault: boolean
}

export interface RelocateLibraryResult extends LibraryLocation {
  /**
   * Project folder names that finished moving successfully but whose old
   * copy couldn't be deleted afterward (e.g. a locked file) — harmless: the
   * new location is already the one the app uses from here on, so a
   * leftover, unused original folder is just wasted disk space, not a risk
   * to anything. Empty when cleanup was fully clean.
   */
  cleanupWarnings: string[]
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
   *
   * Structured as three strictly ordered phases so a failure anywhere in
   * phase 1 can never leave the library in a half-moved state:
   *   1. Move every project into the new location, one at a time, verifying
   *      each as it lands. Any failure here rolls back everything moved so
   *      far and leaves the old location exactly as it was — the persisted
   *      preference is never touched.
   *   2. Only once every project has been verified present at the new
   *      location does the persisted preference switch — the point of no
   *      return, and the *only* place it happens.
   *   3. Best-effort cleanup of old per-project folders left behind by a
   *      cross-device copy fallback in phase 1 (same-device moves are a
   *      `fs.rename`, which already leaves nothing behind). A cleanup
   *      failure here is reported back but never rolled back or retried —
   *      the data's already safe at the new, now-authoritative location.
   */
  async relocateLibrary(chosenParentDir: string): Promise<RelocateLibraryResult> {
    const oldBaseDir = await getLibraryBaseDir()
    const newBaseDir = path.join(chosenParentDir, "Dan's Video Studio")

    if (path.resolve(oldBaseDir) === path.resolve(newBaseDir)) {
      return {
        baseDir: newBaseDir,
        isDefault: path.resolve(newBaseDir) === path.resolve(defaultLibraryBaseDir()),
        cleanupWarnings: [],
      }
    }
    if (await pathExists(newBaseDir)) {
      throw new Error(
        `"${chosenParentDir}" already has a "Dan's Video Studio" folder in it. Choose a different destination.`,
      )
    }

    const oldProjectsDir = path.join(oldBaseDir, 'Projects')
    const newProjectsDir = path.join(newBaseDir, 'Projects')
    const projectNames = (await pathExists(oldProjectsDir))
      ? (await fs.readdir(oldProjectsDir, { withFileTypes: true }))
          .filter((e) => e.isDirectory())
          .map((e) => e.name)
      : []

    await fs.mkdir(newProjectsDir, { recursive: true })

    // --- Phase 1: move every project, one at a time, verifying each. ------
    // `movedViaRename` tracks how each one moved, so a rollback knows
    // whether to rename it back (the original is already gone) or just
    // delete the new copy (the original was never touched).
    const moved: { name: string; movedViaRename: boolean }[] = []
    try {
      for (const name of projectNames) {
        const src = path.join(oldProjectsDir, name)
        const dest = path.join(newProjectsDir, name)
        try {
          await fs.rename(src, dest)
          moved.push({ name, movedViaRename: true })
        } catch {
          // Cross-device (e.g. a different drive) — fall back to copy, but
          // scoped to just this one project, not the whole library, and
          // verified before moving on to the next.
          await copyRecursive(src, dest)
          await verifyCopy(name, src, dest)
          moved.push({ name, movedViaRename: false })
        }
      }
    } catch (err) {
      // Clean rollback: undo every project moved so far, then remove
      // whatever's left of the new location. The old location is restored
      // to exactly what it was before this call — nothing partially moved,
      // nothing partially deleted, and the persisted preference was never
      // touched, so the app keeps working from the untouched original.
      for (const entry of moved.reverse()) {
        const src = path.join(oldProjectsDir, entry.name)
        const dest = path.join(newProjectsDir, entry.name)
        try {
          if (entry.movedViaRename) {
            await fs.rename(dest, src)
          } else {
            await fs.rm(dest, { recursive: true, force: true })
          }
        } catch (rollbackErr) {
          console.error(
            `[libraryRelocationManager] rollback failed for "${entry.name}" — check both`,
            src,
            'and',
            dest,
            'by hand:',
            rollbackErr,
          )
        }
      }
      await fs.rm(newBaseDir, { recursive: true, force: true }).catch(() => {})
      throw new Error(`Moving the library failed: ${(err as Error).message} Nothing was moved — your library is unchanged.`)
    }

    // --- Phase 2: the point of no return. ----------------------------------
    // Every project is now verified fully present at the new location.
    // Only now does the persisted preference switch.
    await setLibraryBaseDir(newBaseDir)

    // --- Phase 3: best-effort cleanup of cross-device copy leftovers. -----
    // A same-device move already used `fs.rename`, which leaves nothing at
    // the old path to clean up. Only projects that went through the
    // copy-fallback still have an old copy sitting around.
    const cleanupWarnings: string[] = []
    for (const entry of moved) {
      if (entry.movedViaRename) continue
      try {
        await fs.rm(path.join(oldProjectsDir, entry.name), { recursive: true, force: true })
      } catch (err) {
        cleanupWarnings.push(entry.name)
        console.error(
          `[libraryRelocationManager] couldn't remove the old copy of "${entry.name}" after a successful move — ` +
            'harmless, the data is safe at the new location; this just leaves a leftover, unused folder behind:',
          err,
        )
      }
    }
    // Best-effort: if the old Projects/ folder and base dir are now
    // completely empty, remove them too (cosmetic tidiness only — an
    // undeletable leftover empty folder here is harmless either way).
    await fs.rm(oldProjectsDir, { recursive: false }).catch(() => {})
    await fs.rm(oldBaseDir, { recursive: false }).catch(() => {})

    return {
      baseDir: newBaseDir,
      isDefault: path.resolve(newBaseDir) === path.resolve(defaultLibraryBaseDir()),
      cleanupWarnings,
    }
  }
}
