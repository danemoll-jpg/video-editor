import { useEffect, useState } from 'react'
import type { ExportProgress, GifQuality, StillImageFormat, Timeline as TimelineData } from '../api'
import type { TimeRange } from './Timeline'

// Phase 7 — Export Tools: one dialog, four tabs (Video/Clip/GIF/Still Frame),
// reached the same way the old MP4-only dialog was (one button on the
// Editor's transport bar) — per TODO.md's "not buried three menus deep" ask,
// every export type is a tab click away, not a separate flow to go find.
// Each tab is a thin form around one of videoExportManager.ts's export
// methods; all the actual compositing/FFmpeg work happens in the main
// process, per CLAUDE.md's architecture.

interface Props {
  projectId: string
  projectName: string
  timeline: TimelineData
  playhead: number
  selection: TimeRange | null
  onClose: () => void
}

type ExportTab = 'mp4' | 'clip' | 'gif' | 'still'
type Destination = 'project' | 'custom'

function fullDuration(timeline: TimelineData): number {
  if (timeline.clips.length === 0) return 0
  return Math.max(...timeline.clips.map((c) => c.startTime + c.duration))
}

function fmt(seconds: number): string {
  return seconds.toFixed(2)
}

/** Rounds to the nearest even integer — GIF dimensions don't strictly need it like libx264 does, but it keeps output consistent and avoids odd-pixel scaling artifacts. */
function evenRound(n: number): number {
  return Math.max(2, Math.round(n / 2) * 2)
}

function DestinationPicker({
  destination,
  setDestination,
  customDir,
  setCustomDir,
  running,
}: {
  destination: Destination
  setDestination: (d: Destination) => void
  customDir: string | null
  setCustomDir: (d: string | null) => void
  running: boolean
}) {
  async function handleBrowse() {
    const dir = await window.api.chooseExportDestination()
    if (dir) setCustomDir(dir)
  }
  return (
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
  )
}

function ProgressAndResult({
  progress,
  running,
  resultPath,
  error,
  destination,
}: {
  progress: ExportProgress | null
  running: boolean
  resultPath: string | null
  error: string | null
  destination: Destination
}) {
  return (
    <>
      {error && <div className="error-banner">{error}</div>}
      {progress && running && (
        <div className="export-progress">
          <div className="export-progress__bar">
            <div className="export-progress__fill" style={{ width: `${Math.round(progress.percent)}%` }} />
          </div>
          <span className="muted">{progress.stage === 'preparing' ? 'Preparing…' : `Encoding… ${Math.round(progress.percent)}%`}</span>
        </div>
      )}
      {resultPath && !running && (
        <div className="export-progress">
          <p>
            ✅ Exported to <code>{resultPath}</code>
          </p>
          {destination === 'project' && <p className="muted">It's also listed in this project's Media Library, under Exports.</p>}
        </div>
      )}
    </>
  )
}

export default function ExportDialog({ projectId, projectName, timeline, playhead, selection, onClose }: Props) {
  const [tab, setTab] = useState<ExportTab>('mp4')
  const [progress, setProgress] = useState<ExportProgress | null>(null)

  useEffect(() => window.api.onExportProgress(setProgress), [])

  const duration = fullDuration(timeline)
  const canvasW = timeline.projectSettings.width
  const canvasH = timeline.projectSettings.height

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal--wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h3>Export</h3>
          <button className="btn" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="tab-bar">
          <button className={`tab-bar__tab ${tab === 'mp4' ? 'tab-bar__tab--active' : ''}`} onClick={() => setTab('mp4')}>
            Video (MP4)
          </button>
          <button className={`tab-bar__tab ${tab === 'clip' ? 'tab-bar__tab--active' : ''}`} onClick={() => setTab('clip')}>
            Clip
          </button>
          <button className={`tab-bar__tab ${tab === 'gif' ? 'tab-bar__tab--active' : ''}`} onClick={() => setTab('gif')}>
            GIF
          </button>
          <button className={`tab-bar__tab ${tab === 'still' ? 'tab-bar__tab--active' : ''}`} onClick={() => setTab('still')}>
            Still Frame
          </button>
        </div>

        {tab === 'mp4' && (
          <Mp4Tab projectId={projectId} projectName={projectName} progress={progress} setProgress={setProgress} onClose={onClose} />
        )}
        {tab === 'clip' && (
          <ClipTab
            projectId={projectId}
            projectName={projectName}
            duration={duration}
            playhead={playhead}
            selection={selection}
            progress={progress}
            setProgress={setProgress}
          />
        )}
        {tab === 'gif' && (
          <GifTab
            projectId={projectId}
            projectName={projectName}
            duration={duration}
            canvasW={canvasW}
            canvasH={canvasH}
            playhead={playhead}
            selection={selection}
            progress={progress}
            setProgress={setProgress}
          />
        )}
        {tab === 'still' && (
          <StillTab projectId={projectId} projectName={projectName} duration={duration} playhead={playhead} />
        )}

        <div className="modal__actions">
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

function Mp4Tab({
  projectId,
  projectName,
  progress,
  setProgress,
  onClose,
}: {
  projectId: string
  projectName: string
  progress: ExportProgress | null
  setProgress: (p: ExportProgress | null) => void
  onClose: () => void
}) {
  const [name, setName] = useState(`${projectName}-export`)
  const [resultPath, setResultPath] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [destination, setDestination] = useState<Destination>('project')
  const [customDir, setCustomDir] = useState<string | null>(null)

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
    <div className="export-tab">
      <p className="muted">Exports the whole timeline as one MP4, at the project's canvas resolution/frame rate.</p>
      <label className="clip-inspector__field">
        <span>File name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} disabled={running} />
      </label>
      <DestinationPicker destination={destination} setDestination={setDestination} customDir={customDir} setCustomDir={setCustomDir} running={running} />
      <ProgressAndResult progress={progress} running={running} resultPath={resultPath} error={error} destination={destination} />
      <div className="modal__actions">
        <button
          className="btn btn--primary"
          disabled={running || !name.trim() || (destination === 'custom' && !customDir)}
          onClick={handleExport}
        >
          {running ? 'Exporting…' : 'Export MP4'}
        </button>
      </div>
    </div>
  )
}

function RangeFields({
  start,
  end,
  setStart,
  setEnd,
  duration,
  playhead,
  selection,
  disabled,
}: {
  start: number
  end: number
  setStart: (n: number) => void
  setEnd: (n: number) => void
  duration: number
  playhead: number
  selection: TimeRange | null
  disabled: boolean
}) {
  return (
    <div className="clip-inspector__field">
      <span>Range (seconds)</span>
      <div className="clip-inspector__row">
        <label className="clip-inspector__field">
          <span>Start</span>
          <input
            type="number"
            min={0}
            step={0.1}
            value={fmt(start)}
            disabled={disabled}
            onChange={(e) => setStart(Math.max(0, Number(e.target.value) || 0))}
          />
        </label>
        <label className="clip-inspector__field">
          <span>End</span>
          <input
            type="number"
            min={0}
            step={0.1}
            value={fmt(end)}
            disabled={disabled}
            onChange={(e) => setEnd(Math.max(0, Number(e.target.value) || 0))}
          />
        </label>
      </div>
      <div className="inline-form">
        <button className="btn" disabled={disabled} onClick={() => setStart(playhead)}>
          Start = Playhead ({fmt(playhead)}s)
        </button>
        <button className="btn" disabled={disabled} onClick={() => setEnd(playhead)}>
          End = Playhead ({fmt(playhead)}s)
        </button>
        {selection && (
          <button
            className="btn"
            disabled={disabled}
            onClick={() => {
              setStart(selection.start)
              setEnd(selection.end)
            }}
          >
            Use timeline selection
          </button>
        )}
        <button
          className="btn"
          disabled={disabled}
          onClick={() => {
            setStart(0)
            setEnd(duration)
          }}
        >
          Use full timeline
        </button>
      </div>
      {end <= start && <p className="error-banner">End must be after start.</p>}
    </div>
  )
}

function ClipTab({
  projectId,
  projectName,
  duration,
  playhead,
  selection,
  progress,
  setProgress,
}: {
  projectId: string
  projectName: string
  duration: number
  playhead: number
  selection: TimeRange | null
  progress: ExportProgress | null
  setProgress: (p: ExportProgress | null) => void
}) {
  const [name, setName] = useState(`${projectName}-clip`)
  const [start, setStart] = useState(selection?.start ?? 0)
  const [end, setEnd] = useState(selection?.end ?? duration)
  const [resultPath, setResultPath] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [destination, setDestination] = useState<Destination>('project')
  const [customDir, setCustomDir] = useState<string | null>(null)

  async function handleExport() {
    setRunning(true)
    setError(null)
    setResultPath(null)
    setProgress({ stage: 'preparing', percent: 0 })
    try {
      const result = await window.api.exportClip(
        projectId,
        name,
        { start, end },
        destination === 'custom' ? customDir ?? undefined : undefined,
      )
      setResultPath(result.outputPath)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="export-tab">
      <p className="muted">Exports just a window of the timeline as its own standalone MP4 — everything else is trimmed out.</p>
      <RangeFields
        start={start}
        end={end}
        setStart={setStart}
        setEnd={setEnd}
        duration={duration}
        playhead={playhead}
        selection={selection}
        disabled={running}
      />
      <label className="clip-inspector__field">
        <span>File name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} disabled={running} />
      </label>
      <DestinationPicker destination={destination} setDestination={setDestination} customDir={customDir} setCustomDir={setCustomDir} running={running} />
      <ProgressAndResult progress={progress} running={running} resultPath={resultPath} error={error} destination={destination} />
      <div className="modal__actions">
        <button className="btn btn--primary" disabled={running || !name.trim() || end <= start || (destination === 'custom' && !customDir)} onClick={handleExport}>
          {running ? 'Exporting…' : 'Export Clip'}
        </button>
      </div>
    </div>
  )
}

const GIF_QUALITY_OPTIONS: { value: GifQuality; label: string }[] = [
  { value: 'low', label: 'Low (smaller file)' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High (larger file)' },
]

function GifTab({
  projectId,
  projectName,
  duration,
  canvasW,
  canvasH,
  playhead,
  selection,
  progress,
  setProgress,
}: {
  projectId: string
  projectName: string
  duration: number
  canvasW: number
  canvasH: number
  playhead: number
  selection: TimeRange | null
  progress: ExportProgress | null
  setProgress: (p: ExportProgress | null) => void
}) {
  const [name, setName] = useState(`${projectName}`)
  const [start, setStart] = useState(selection?.start ?? 0)
  const [end, setEnd] = useState(selection?.end ?? Math.min(duration, 5))
  const [width, setWidth] = useState(evenRound(Math.min(480, canvasW)))
  const [lockAspect, setLockAspect] = useState(true)
  const [height, setHeight] = useState(evenRound((Math.min(480, canvasW) * canvasH) / canvasW))
  const [fps, setFps] = useState(12)
  const [quality, setQuality] = useState<GifQuality>('medium')
  const [loop, setLoop] = useState(true)
  const [resultPath, setResultPath] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [destination, setDestination] = useState<Destination>('project')
  const [customDir, setCustomDir] = useState<string | null>(null)

  function handleWidthChange(w: number) {
    setWidth(w)
    if (lockAspect) setHeight(evenRound((w * canvasH) / canvasW))
  }

  async function handleExport() {
    setRunning(true)
    setError(null)
    setResultPath(null)
    setProgress({ stage: 'preparing', percent: 0 })
    try {
      const result = await window.api.exportGif(
        projectId,
        name,
        { range: { start, end }, width, height, fps, quality, loop },
        destination === 'custom' ? customDir ?? undefined : undefined,
      )
      setResultPath(result.outputPath)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="export-tab">
      <p className="muted">Exports a window of the timeline as an animated GIF, at its own dimensions/frame rate/quality — separate from the project's canvas settings.</p>
      <RangeFields
        start={start}
        end={end}
        setStart={setStart}
        setEnd={setEnd}
        duration={duration}
        playhead={playhead}
        selection={selection}
        disabled={running}
      />
      <div className="clip-inspector__row">
        <label className="clip-inspector__field">
          <span>Width (px)</span>
          <input type="number" min={2} step={2} value={width} disabled={running} onChange={(e) => handleWidthChange(Number(e.target.value) || width)} />
        </label>
        <label className="clip-inspector__field">
          <span>Height (px)</span>
          <input
            type="number"
            min={2}
            step={2}
            value={height}
            disabled={running || lockAspect}
            onChange={(e) => setHeight(Number(e.target.value) || height)}
          />
        </label>
        <label className="clip-inspector__field">
          <span>FPS</span>
          <input type="number" min={1} max={60} value={fps} disabled={running} onChange={(e) => setFps(Math.max(1, Number(e.target.value) || fps))} />
        </label>
      </div>
      <label className="clip-inspector__checkbox">
        <input type="checkbox" checked={lockAspect} disabled={running} onChange={(e) => setLockAspect(e.target.checked)} />
        Lock aspect ratio to the project canvas ({canvasW}×{canvasH})
      </label>
      <div className="clip-inspector__row">
        <label className="clip-inspector__field">
          <span>Quality</span>
          <select value={quality} disabled={running} onChange={(e) => setQuality(e.target.value as GifQuality)}>
            {GIF_QUALITY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="clip-inspector__checkbox">
          <input type="checkbox" checked={loop} disabled={running} onChange={(e) => setLoop(e.target.checked)} />
          Loop forever (unchecked = play once)
        </label>
      </div>
      <label className="clip-inspector__field">
        <span>File name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} disabled={running} />
      </label>
      <DestinationPicker destination={destination} setDestination={setDestination} customDir={customDir} setCustomDir={setCustomDir} running={running} />
      <ProgressAndResult progress={progress} running={running} resultPath={resultPath} error={error} destination={destination} />
      <div className="modal__actions">
        <button
          className="btn btn--primary"
          disabled={running || !name.trim() || end <= start || width < 2 || height < 2 || (destination === 'custom' && !customDir)}
          onClick={handleExport}
        >
          {running ? 'Exporting…' : 'Export GIF'}
        </button>
      </div>
    </div>
  )
}

function StillTab({
  projectId,
  projectName,
  duration,
  playhead,
}: {
  projectId: string
  projectName: string
  duration: number
  playhead: number
}) {
  const [name, setName] = useState(`${projectName}-frame`)
  const [time, setTime] = useState(playhead)
  const [format, setFormat] = useState<StillImageFormat>('png')
  const [resultPath, setResultPath] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [destination, setDestination] = useState<Destination>('project')
  const [customDir, setCustomDir] = useState<string | null>(null)

  async function handleExport() {
    setRunning(true)
    setError(null)
    setResultPath(null)
    try {
      const result = await window.api.exportStillFrame(
        projectId,
        name,
        { time, format },
        destination === 'custom' ? customDir ?? undefined : undefined,
      )
      setResultPath(result.outputPath)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="export-tab">
      <p className="muted">Captures exactly one composited frame from the timeline as a PNG or JPEG.</p>
      <div className="clip-inspector__row">
        <label className="clip-inspector__field">
          <span>Time (seconds)</span>
          <input
            type="number"
            min={0}
            max={duration}
            step={0.1}
            value={fmt(time)}
            disabled={running}
            onChange={(e) => setTime(Math.max(0, Number(e.target.value) || 0))}
          />
        </label>
        <label className="clip-inspector__field">
          <span>Format</span>
          <select value={format} disabled={running} onChange={(e) => setFormat(e.target.value as StillImageFormat)}>
            <option value="png">PNG</option>
            <option value="jpg">JPEG</option>
          </select>
        </label>
      </div>
      <div className="inline-form">
        <button className="btn" disabled={running} onClick={() => setTime(playhead)}>
          Use Playhead ({fmt(playhead)}s)
        </button>
      </div>
      <label className="clip-inspector__field">
        <span>File name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} disabled={running} />
      </label>
      <DestinationPicker destination={destination} setDestination={setDestination} customDir={customDir} setCustomDir={setCustomDir} running={running} />
      <ProgressAndResult progress={null} running={running} resultPath={resultPath} error={error} destination={destination} />
      <div className="modal__actions">
        <button
          className="btn btn--primary"
          disabled={running || !name.trim() || (destination === 'custom' && !customDir)}
          onClick={handleExport}
        >
          {running ? 'Capturing…' : 'Export Still Frame'}
        </button>
      </div>
    </div>
  )
}
