import { useEffect, useMemo, useState } from 'react'
import type { AssetKind, ExportFile, MediaLibraryEntry } from '../api'
import { formatBytes, formatDate } from '../format'
import MediaLibraryCard from './MediaLibraryCard'
import AudioEditor from './AudioEditor'

interface Props {
  projectId: string
}

type KindFilter = AssetKind | 'all'

const KIND_FILTERS: { key: KindFilter; label: string }[] = [
  { key: 'all', label: 'All kinds' },
  { key: 'video', label: 'Video' },
  { key: 'image', label: 'Image' },
  { key: 'audio', label: 'Audio' },
  { key: 'other', label: 'Other' },
]

/**
 * Phase 5's Media Library — a single searchable view across every asset
 * (video/image/audio/other), cross-referenced back to the shots, prompt lab
 * entries/ratings, and SFX library entries that actually use it (see
 * electron/mediaLibraryManager.ts, which does the cross-referencing; this
 * component just filters/searches the result client-side, since a personal
 * project's asset count is small). Also lists whatever's in the project's
 * exports/ folder — empty until Phase 6/7 builds export tools, but part of
 * the same "everything this project has produced" picture.
 */
export default function MediaLibrary({ projectId }: Props) {
  const [entries, setEntries] = useState<MediaLibraryEntry[]>([])
  const [exports, setExports] = useState<ExportFile[]>([])
  const [loading, setLoading] = useState(true)
  // Tracks whether the *first* load has completed, separately from `loading`
  // itself — `refresh()` is called again every time the Audio Editor commits
  // or splits an asset (as its `onCommitted` callback), and re-gating the
  // entire render behind a bare `loading` check on every one of those calls
  // was unmounting the whole tree (including that same open Audio Editor
  // modal) for the duration of the refetch, silently discarding its local
  // state — e.g. the "✅ Saved as a new audio asset" confirmation never got
  // to render, because the component showing it had already been torn down
  // and remounted fresh by the time the fetch resolved. Only the initial
  // mount's load should show the full-page loading state.
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [query, setQuery] = useState('')
  const [kindFilter, setKindFilter] = useState<KindFilter>('all')
  const [onlyUnused, setOnlyUnused] = useState(false)
  const [editingEntry, setEditingEntry] = useState<MediaLibraryEntry | null>(null)

  async function refresh() {
    setLoading(true)
    try {
      const [library, exportFiles] = await Promise.all([
        window.api.getMediaLibrary(projectId),
        window.api.listExports(projectId),
      ])
      setEntries(library)
      setExports(exportFiles)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
      setHasLoadedOnce(true)
    }
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return entries
      .filter((e) => kindFilter === 'all' || e.kind === kindFilter)
      .filter((e) => !onlyUnused || e.usages.length === 0)
      .filter((e) => {
        if (!q) return true
        const haystack = [e.originalName, ...e.sfxTags, e.sfxLicense ?? '', ...e.usages.map((u) => `${u.label} ${u.detail}`)]
          .join(' ')
          .toLowerCase()
        return haystack.includes(q)
      })
      .sort((a, b) => a.originalName.localeCompare(b.originalName))
  }, [entries, query, kindFilter, onlyUnused])

  if (loading && !hasLoadedOnce) return <p className="muted">Loading media library…</p>

  return (
    <div className="media-library">
      {error && <div className="error-banner">{error}</div>}

      <div className="media-library__toolbar">
        <input
          type="text"
          placeholder="Search by name, tag, scene/shot, or prompt…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value as KindFilter)}>
          {KIND_FILTERS.map((f) => (
            <option key={f.key} value={f.key}>
              {f.label}
            </option>
          ))}
        </select>
        <label className="media-library__checkbox">
          <input type="checkbox" checked={onlyUnused} onChange={(e) => setOnlyUnused(e.target.checked)} />
          Unused only
        </label>
        <div className="spacer" />
        <span className="muted">
          {filtered.length} of {entries.length}
        </span>
      </div>

      {entries.length === 0 ? (
        <p className="muted">
          No assets imported yet. Bring some in via the Assets tab, then come back here to search and see
          where each one gets used.
        </p>
      ) : filtered.length === 0 ? (
        <p className="muted">No assets match this search/filter.</p>
      ) : (
        <div className="media-grid">
          {filtered.map((entry) => (
            <MediaLibraryCard key={entry.id} entry={entry} onEditAudio={setEditingEntry} />
          ))}
        </div>
      )}

      <section className="asset-section media-library__exports">
        <h3>
          Exports <span className="muted">({exports.length})</span>
        </h3>
        {exports.length === 0 ? (
          <p className="muted">
            Nothing exported yet — Phase 6/7's editing and export tools will land finished files here.
          </p>
        ) : (
          <div className="asset-grid">
            {exports.map((file) => (
              <div key={file.name} className="asset-card">
                <div className="asset-card__name" title={file.name}>
                  {file.name}
                </div>
                <div className="asset-card__meta">{formatBytes(file.sizeBytes)}</div>
                <div className="asset-card__meta">{formatDate(file.modifiedAt)}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      {editingEntry && (
        <AudioEditor
          projectId={projectId}
          entry={editingEntry}
          onClose={() => setEditingEntry(null)}
          onCommitted={refresh}
        />
      )}
    </div>
  )
}
