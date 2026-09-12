import { app, safeStorage } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'

// --- Data model -------------------------------------------------------
//
// App-level (not per-project) settings — currently just the Anthropic API
// key used by aiAssistantManager.ts for Phase 4's AI Assistant. Stored
// under Electron's userData folder (not a project folder — this isn't
// project data), as a single file holding the OS-encrypted key bytes from
// `safeStorage.encryptString`, not JSON — so this manager talks to `fs`
// directly instead of reusing fsUtils.ts's JSON helpers.
//
// The decrypted key is never exposed over IPC — `getDecryptedApiKey` is for
// aiAssistantManager.ts (main process) to call the Anthropic API with; the
// renderer only ever sees whether a key is set (`hasApiKey`), never the key
// itself, per CLAUDE.md's "must never reach the renderer" rule.

function settingsDir(): string {
  return path.join(app.getPath('userData'), 'settings')
}

function apiKeyFile(): string {
  return path.join(settingsDir(), 'anthropicKey.enc')
}

export class SettingsManager {
  async hasApiKey(): Promise<boolean> {
    try {
      await fs.access(apiKeyFile())
      return true
    } catch {
      return false
    }
  }

  async setApiKey(key: string): Promise<boolean> {
    const trimmed = key.trim()
    if (!trimmed) throw new Error('API key cannot be empty.')
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Secure storage is not available on this machine, so the key cannot be saved safely.')
    }
    const encrypted = safeStorage.encryptString(trimmed)
    await fs.mkdir(settingsDir(), { recursive: true })
    await fs.writeFile(apiKeyFile(), encrypted)
    return true
  }

  async clearApiKey(): Promise<boolean> {
    try {
      await fs.unlink(apiKeyFile())
    } catch {
      // Already absent — clearing a never-set key is not an error.
    }
    return false
  }

  /** Main-process-only. Never call this from an IPC handler that returns to the renderer. */
  async getDecryptedApiKey(): Promise<string | null> {
    try {
      const encrypted = await fs.readFile(apiKeyFile())
      if (!safeStorage.isEncryptionAvailable()) return null
      return safeStorage.decryptString(encrypted)
    } catch {
      return null
    }
  }
}
