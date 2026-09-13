// Where Dan's Video Studio's entire project library lives on disk. Defaults
// to <Documents>/Dan's Video Studio (projectPaths.ts's original, hardcoded
// location) unless Settings has relocated it — see libraryRelocationManager.ts
// for the actual data-moving migration — in which case the chosen folder is
// remembered here, in a small preference file under Electron's userData
// folder (an app-level preference, not project data — same category as
// settingsManager.ts's API key, but plain JSON since there's nothing here
// that needs OS-level encryption).

import { app } from 'electron'
import path from 'node:path'
import { readJsonFile, writeJsonFile } from './fsUtils'

interface LibraryLocationPrefs {
  /** Absolute path to the "Dan's Video Studio" folder itself, or null for the default Documents location. */
  customBaseDir: string | null
}

function prefsPath(): string {
  return path.join(app.getPath('userData'), 'settings', 'libraryLocation.json')
}

export function defaultLibraryBaseDir(): string {
  return path.join(app.getPath('documents'), "Dan's Video Studio")
}

export async function getLibraryBaseDir(): Promise<string> {
  const prefs = await readJsonFile<LibraryLocationPrefs>(prefsPath(), { customBaseDir: null })
  return prefs.customBaseDir ?? defaultLibraryBaseDir()
}

export async function setLibraryBaseDir(newBaseDir: string | null): Promise<void> {
  const prefs: LibraryLocationPrefs = { customBaseDir: newBaseDir }
  await writeJsonFile(prefsPath(), prefs)
}
