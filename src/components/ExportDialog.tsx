import { useEffect, useState } from 'react'
import type { ExportProgress } from '../api'

interface Props {
  projectId: string
  defaultName: string
  onClose: () => void
}

export default function ExportDialog({ projectId, defaultName, onClose }: Props) {
  const [name, setName] = useState(defaultName)
  const [progress, setProgress] = useState<ExportProgress | null>(null)
  const [resultPath, setResultPath] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)

  useEffect(() => {
    return window.api.onExportProgress(setProgress)
  }, [])

  async function handleExport() {
    setRunning(true)
    setError(null)
    setResultPath(null)
    setProgress({ stage: 'preparing', percent: 0 })
    try {
      const result = await window.api.exportTimeline(projectId, name)
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
            <p className="muted">It's also listed in this project's Media Library, under Exports.</p>
          </div>
        )}

        <div className="modal__actions">
          <button className="btn" onClick={onClose}>
            Close
          </button>
          <button className="btn btn--primary" disabled={running || !name.trim()} onClick={handleExport}>
            {running ? 'Exporting…' : 'Export'}
          </button>
        </div>
      </div>
    </div>
  )
}
