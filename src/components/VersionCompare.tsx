import { formatDate } from '../format'
import { averageScores, type Scoreable } from '../ratingUtils'

/** Structural shape both a prompt-lab PromptEntry and a unified SfxEntry satisfy — this component (and RecipeCard) work with either. */
export interface CompareEntry {
  id: string
  createdAt: string
  promptText: string
  lyrics?: string
  settings: string
  ratings: Scoreable[]
}

interface Dimension {
  key: string
  label: string
}

interface Props {
  entries: [CompareEntry, CompareEntry]
  dimensions: Dimension[]
  showLyrics: boolean
  onClose: () => void
}

function Column({
  entry,
  dimensions,
  showLyrics,
}: {
  entry: CompareEntry
  dimensions: Dimension[]
  showLyrics: boolean
}) {
  const { perDimension, overall } = averageScores(entry.ratings, dimensions.map((d) => d.key))
  return (
    <div className="version-compare__column">
      <div className="muted">{formatDate(entry.createdAt)}</div>
      <div className="prompt-entry-card__field-block">
        <div className="muted field-label">Prompt</div>
        <p className="prompt-entry-card__text">{entry.promptText}</p>
      </div>
      {showLyrics && entry.lyrics && (
        <div className="prompt-entry-card__field-block">
          <div className="muted field-label">Lyrics</div>
          <p className="prompt-entry-card__text">{entry.lyrics}</p>
        </div>
      )}
      {entry.settings && (
        <div className="prompt-entry-card__field-block">
          <div className="muted field-label">Settings</div>
          <p className="prompt-entry-card__text">{entry.settings}</p>
        </div>
      )}
      <div className="prompt-entry-card__field-block">
        <div className="muted field-label">
          Average rating ({entry.ratings.length} clip{entry.ratings.length === 1 ? '' : 's'})
        </div>
        {overall === null ? (
          <p className="muted">Not rated yet.</p>
        ) : (
          <table className="version-compare__scores">
            <tbody>
              {dimensions.map((d) => (
                <tr key={d.key}>
                  <td className="muted">{d.label}</td>
                  <td>{perDimension[d.key] !== null ? perDimension[d.key]!.toFixed(1) : '—'}</td>
                </tr>
              ))}
              <tr>
                <td className="muted">Overall</td>
                <td>
                  <strong>{overall.toFixed(1)}</strong>
                </td>
              </tr>
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

/** Side-by-side read-only comparison of two prompt-history entries, picked via the checkboxes on the history list. */
export default function VersionCompare({ entries, dimensions, showLyrics, onClose }: Props) {
  return (
    <div className="version-compare">
      <div className="version-compare__header">
        <h3>Compare Versions</h3>
        <div className="spacer" />
        <button className="btn" onClick={onClose}>
          Close Comparison
        </button>
      </div>
      <div className="version-compare__columns">
        {entries.map((entry) => (
          <Column key={entry.id} entry={entry} dimensions={dimensions} showLyrics={showLyrics} />
        ))}
      </div>
    </div>
  )
}
