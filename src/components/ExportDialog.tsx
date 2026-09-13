import { useEffect, useState } from 'react'
import type { ExportProgress } from '../api'

interface Props {
  projectId: string
  defaultName: string
  onClose: () => void
}

type Destination = 'project' | 'custom'

export default function ExportDialog({ projectId, defaultName, onClose }: Props) {
  const [name, setName] = useState(defaultName)
  const [progress, setProgress] = useState<ExportProgress | null>(null)
  const [resultPath, setResultPath] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [destination, setDestination] = useState<Destination>('project')
  const [customDir, setCustomDir] = useState<string | null>(null)

  useEffect(() => {
    return window.api.onExportProgress(setProgress)
  }, [])

  async function handleBrowse() {
    const dir = await window.api.chooseExportDestination()
    if (dir) setCustomDir(dir)
  }

  async function handleExport() {
    setRunning(true)
    setError(null)
    setResultPath(null)
    setProgress({ stage: 'preparing', percent: 0 })
    try {
      const result = await window.api.exportTimeline(projectId, name, destination === 'custom' ? customDir ?? undefined : undefined)
      setResultPath(result.outputPath)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h3>Export MP4</h3>
          <button className="btn" onClick={onClose}>
            ×
          </button>
        </div>

        <label className="clip-inspector__field">
          <span>File name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} disabled={running} />
        </label>

        <div className="clip-inspector__field">
          <span>Save to</span>
          <label className="clip-inspector__checkbox">
            <input
              type="radio"
              name="export-destination"
              checked={destination === 'project'}
              disabled={running}
              onChange={() => setDestination('project')}
            />
            This project's exports folder (shows up in Media Library)
          </label>
          <label className="clip-inspector__checkbox">
            <input
              type="radio"
              name="export-destination"
              checked={destination === 'custom'}
              disabled={running}
              onChange={() => setDestination('custom')}
            />
            Choose a different folder
          </label>
          {destination === 'custom' && (
            <div className="inline-form">
              <input value={customDir ?? ''} readOnly placeholder="No folder chosen yet…" />
              <button className="btn" disabled={running} onClick={handleBrowse}>
                Browse…
              </button>
            </div>
          )}
        </div>

        {error && <div className="error-banner">{error}</div>}

        {progress && running && (
          <div className="export-progress">
            <div className="export-progress__bar">
              <div className="export-progress__fill" style={{ width: `${Math.round(progress.percent)}%` }} />
            </div>
            <span className="muted">
              {progress.stage === 'preparing' ? 'Preparing…' : `Encoding… ${Math.round(progress.percent)}%`}
            </span>
          </div>
        )}

        {resultPath && !running && (
          <div className="export-progress">
            <p>
              ✅ Exported to <code>{resultPath}</code>
            </p>
            {destination === 'project' && (
              <p className="muted">It's also listed in this project's Media Library, under Exports.</p>
            )}
          </div>
        )}

        <div className="modal__actions">
          <button className="btn" onClick={onClose}>
            Close
          </button>
          <button
            className="btn btn--primary"
            disabled={running || !name.trim() || (destination === 'custom' && !customDir)}
            onClick={handleExport}
          >
            {running ? 'Exporting…' : 'Export'}
          </button>
        </div>
      </div>
    </div>
  )
}
