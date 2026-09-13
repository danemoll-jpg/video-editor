import { useEffect, useState } from 'react'
import type { LibraryLocation } from '../api'

/**
 * Phase 4's Settings screen — currently just the Anthropic API key used by
 * the AI Assistant (electron/settingsManager.ts, electron/aiAssistantManager.ts).
 * The key is write-only from here: `window.api.hasApiKey()` only ever
 * reports whether one is set, never the key itself, since the decrypted key
 * must never reach the renderer.
 */
export default function Settings() {
  const [hasKey, setHasKey] = useState(false)
  const [loading, setLoading] = useState(true)
  const [keyInput, setKeyInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const [library, setLibrary] = useState<LibraryLocation | null>(null)
  const [relocating, setRelocating] = useState(false)
  const [libraryError, setLibraryError] = useState<string | null>(null)

  function refreshLibraryLocation() {
    window.api.getLibraryLocation().then(setLibrary).catch((err) => setLibraryError(err instanceof Error ? err.message : String(err)))
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    window.api
      .hasApiKey()
      .then((v) => {
        if (!cancelled) {
          setHasKey(v)
          setError(null)
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    refreshLibraryLocation()
    return () => {
      cancelled = true
    }
  }, [])

  async function handleRelocateLibrary() {
    const confirmed = window.confirm(
      "This moves every existing project's files to the folder you choose next. It can take a while for a large library — don't close the app while it's running. Continue?",
    )
    if (!confirmed) return
    setRelocating(true)
    setLibraryError(null)
    try {
      const result = await window.api.relocateLibrary()
      if (result) {
        setLibrary(result)
        setMessage(`Library moved to ${result.baseDir}.`)
      }
    } catch (err) {
      setLibraryError(err instanceof Error ? err.message : String(err))
    } finally {
      setRelocating(false)
    }
  }

  async function handleSave() {
    if (!keyInput.trim() || saving) return
    setSaving(true)
    try {
      setHasKey(await window.api.setApiKey(keyInput))
      setKeyInput('')
      setMessage('API key saved.')
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  async function handleClear() {
    const confirmed = window.confirm(
      'Remove the saved Anthropic API key? The AI Assistant will stop working until a new key is added.',
    )
    if (!confirmed) return
    try {
      setHasKey(await window.api.clearApiKey())
      setMessage('API key removed.')
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  if (loading) return <p className="muted">Loading settings…</p>

  return (
    <div className="settings-view">
      <h2>Settings</h2>

      <section className="settings-section">
        <h3>Library Location</h3>
        <p className="muted">
          Where every project's files live on disk — by default, buried inside your OS's Documents folder.
          Moving it here migrates all existing projects to the new folder; nothing is left behind or duplicated.
        </p>

        {libraryError && <div className="error-banner">{libraryError}</div>}

        <p>
          Current location:{' '}
          <code>{library ? library.baseDir : 'Loading…'}</code>
          {library?.isDefault && <span className="muted"> (default)</span>}
        </p>

        <div className="inline-form">
          <button className="btn btn--primary" disabled={relocating || !library} onClick={handleRelocateLibrary}>
            {relocating ? 'Moving…' : 'Move Library…'}
          </button>
        </div>
      </section>

      <section className="settings-section">
        <h3>Anthropic API Key</h3>
        <p className="muted">
          Used by the AI Assistant (in the Idea, Script, and Prompt Lab tabs of a project) to call Claude
          directly. Stored encrypted on this device via your OS's secure storage — never in plaintext,
          and never sent anywhere except directly to Anthropic when you use the assistant. Using your own
          key means real, per-use API cost.
        </p>

        {error && <div className="error-banner">{error}</div>}
        {message && <p className="muted">{message}</p>}

        <p>Status: {hasKey ? '✅ API key configured' : 'No API key set'}</p>

        <div className="inline-form">
          <input
            type="password"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder={hasKey ? 'Enter a new key to replace the saved one…' : 'sk-ant-…'}
            autoComplete="off"
          />
          <button className="btn btn--primary" disabled={!keyInput.trim() || saving} onClick={handleSave}>
            {saving ? 'Saving…' : 'Save Key'}
          </button>
          {hasKey && (
            <button className="btn btn--danger" onClick={handleClear}>
              Remove Key
            </button>
          )}
        </div>
      </section>
    </div>
  )
}
