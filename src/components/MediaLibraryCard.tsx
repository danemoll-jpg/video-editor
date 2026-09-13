import type { AssetKind, MediaLibraryEntry } from '../api'
import { formatBytes, formatDate } from '../format'

const KIND_ICONS: Record<AssetKind, string> = {
  video: '🎬',
  image: '🖼️',
  audio: '🎵',
  other: '📄',
}

const USAGE_ICONS: Record<MediaLibraryEntry['usages'][number]['type'], string> = {
  shot: '🎬',
  promptEntry: '📝',
  promptRating: '⭐',
  sfx: '🔊',
}

interface Props {
  entry: MediaLibraryEntry
}

/** One asset in the Media Library — its own metadata plus every place it's actually used, cross-referenced from Scenes & Shots, the Prompt Labs, and the SFX library. */
export default function MediaLibraryCard({ entry }: Props) {
  return (
    <div className="media-card">
      <div className="media-card__header">
        <span className="media-card__kind" title={entry.kind}>
          {KIND_ICONS[entry.kind]}
        </span>
        <span className="media-card__name" title={entry.originalName}>
          {entry.originalName}
        </span>
      </div>

      <div className="media-card__meta">
        {formatBytes(entry.sizeBytes)} · Imported {formatDate(entry.importedAt)}
      </div>

      {entry.sfxTags.length > 0 && (
        <span className="tag-list">
          {entry.sfxTags.map((t) => (
            <span key={t} className="tag">
              {t}
            </span>
          ))}
        </span>
      )}
      {entry.sfxLicense && <div className="media-card__meta">License: {entry.sfxLicense}</div>}

      {entry.usages.length === 0 ? (
        <p className="media-card__unused">Not used anywhere yet.</p>
      ) : (
        <div className="media-card__usages">
          {entry.usages.map((usage, i) => (
            <div key={i} className="media-card__usage" title={usage.detail}>
              {USAGE_ICONS[usage.type]} <span className="media-card__usage-label">{usage.label}</span> —{' '}
              {usage.detail}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
