import { useEffect, useState } from 'react'
import type { Asset, SfxLibraryEntry, SfxLibraryEntryUpdates } from '../api'
import { formatDate } from '../format'

interface Props {
  projectId: string
  assets: Asset[]
}

const EMPTY_FORM = { name: '', tagsText: '', sourceUrl: '', license: '', attribution: '', linkedAssetId: '', notes: '' }

/** The fourth Phase 3 subsystem: a tagged library of free-source SFX with license/attribution tracking, distinct from the prompt-history pattern the other three labs share. */
export default function SfxLibraryPanel({ projectId, assets }: Props) {
  const [entries, setEntries] = useState<SfxLibraryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  const audioAssets = assets.filter((a) => a.kind === 'audio')

  async function refresh() {
    setLoading(true)
    try {
      setEntries(await window.api.listSfxEntries(projectId))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  async function guard(action: () => Promise<void>) {
    try {
      await action()
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  function openNewForm() {
    setForm(EMPTY_FORM)
    setEditingId(null)
    setShowForm(true)
  }

  function openEditForm(entry: SfxLibraryEntry) {
    setForm({
      name: entry.name,
      tagsText: entry.tags.join(', '),
      sourceUrl: entry.sourceUrl,
      license: entry.license,
      attribution: entry.attribution,
      linkedAssetId: entry.linkedAssetId ?? '',
      notes: entry.notes,
    })
    setEditingId(entry.id)
    setShowForm(true)
  }

  async function handleSubmit() {
    if (!form.name.trim() || saving) return
    setSaving(true)
    const payload = {
      name: form.name,
      tags: form.tagsText
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      sourceUrl: form.sourceUrl,
      license: form.license,
      attribution: form.attribution,
      linkedAssetId: form.linkedAssetId || null,
      notes: form.notes,
    }
    await guard(async () => {
      if (editingId) {
        setEntries(await window.api.updateSfxEntry(projectId, editingId, payload as SfxLibraryEntryUpdates))
      } else {
        setEntries(await window.api.createSfxEntry(projectId, payload))
      }
      setShowForm(false)
      setForm(EMPTY_FORM)
      setEditingId(null)
    })
    setSaving(false)
  }

  function handleDelete(id: string) {
    if (!window.confirm('Delete this SFX library entry?')) return
    guard(async () => setEntries(await window.api.deleteSfxEntry(projectId, id)))
  }

  if (loading) return <p className="muted">Loading SFX library…</p>

  return (
    <div className="sfx-library">
      {error && <div className="error-banner">{error}</div>}

      <div className="tab-panel__toolbar">
        <span className="muted">Tagged, licensed free-source SFX with attribution tracking.</span>
        <div className="spacer" />
        <button className="btn btn--primary" onClick={() => (showForm ? setShowForm(false) : openNewForm())}>
          {showForm ? 'Cancel' : '+ Add SFX'}
        </button>
      </div>

      {showForm && (
        <div className="inline-form inline-form--column new-prompt-form">
          <label className="shot-card__field">
            Name
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Heavy door creak"
              autoFocus
            />
          </label>
          <label className="shot-card__field">
            Tags (comma-separated)
            <input
              value={form.tagsText}
              onChange={(e) => setForm((f) => ({ ...f, tagsText: e.target.value }))}
              placeholder="door, creak, horror"
            />
          </label>
          <label className="shot-card__field">
            Source URL
            <input
              value={form.sourceUrl}
              onChange={(e) => setForm((f) => ({ ...f, sourceUrl: e.target.value }))}
              placeholder="Where it was downloaded from"
            />
          </label>
          <label className="shot-card__field">
            License
            <input
              value={form.license}
              onChange={(e) => setForm((f) => ({ ...f, license: e.target.value }))}
              placeholder="e.g. CC0, CC-BY 4.0, Pixabay License"
            />
          </label>
          <label className="shot-card__field">
            Attribution text
            <textarea
              value={form.attribution}
              onChange={(e) => setForm((f) => ({ ...f, attribution: e.target.value }))}
              rows={2}
              placeholder="Exact credit line required by the license, if any"
            />
          </label>
          <label className="shot-card__field">
            Linked audio asset
            <select
              value={form.linkedAssetId}
              onChange={(e) => setForm((f) => ({ ...f, linkedAssetId: e.target.value }))}
            >
              <option value="">None — import the file via the Assets tab first, then link it here</option>
              {audioAssets.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.originalName}
                </option>
              ))}
            </select>
          </label>
          <label className="shot-card__field">
            Notes
            <textarea
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              rows={2}
            />
          </label>
          <div className="shot-card__field-actions">
            <button className="btn btn--primary" disabled={!form.name.trim() || saving} onClick={handleSubmit}>
              {saving ? 'Saving…' : editingId ? 'Save Changes' : 'Add to Library'}
            </button>
          </div>
        </div>
      )}

      {entries.length === 0 ? (
        <p className="muted">
          No SFX in the library yet. Import the audio file via the Assets tab, then add an entry here
          with its tags, license, and attribution.
        </p>
      ) : (
        <div className="asset-grid">
          {entries.map((entry) => {
            const linkedAsset = entry.linkedAssetId ? assets.find((a) => a.id === entry.linkedAssetId) : undefined
            return (
              <div key={entry.id} className="asset-card sfx-card">
                <div className="asset-card__name" title={entry.name}>
                  {entry.name}
                </div>
                {entry.tags.length > 0 && (
                  <span className="tag-list">
                    {entry.tags.map((t) => (
                      <span key={t} className="tag">
                        {t}
                      </span>
                    ))}
                  </span>
                )}
                <div className="asset-card__meta">{entry.license || 'License not set'}</div>
                {entry.attribution && <div className="asset-card__meta sfx-card__attribution">{entry.attribution}</div>}
                {linkedAsset && <div className="asset-card__meta">🔊 {linkedAsset.originalName}</div>}
                <div className="asset-card__meta">Added {formatDate(entry.createdAt)}</div>
                <div className="sfx-card__actions">
                  <button className="btn" onClick={() => openEditForm(entry)}>
                    Edit
                  </button>
                  <button className="btn btn--danger" onClick={() => handleDelete(entry.id)}>
                    Delete
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
