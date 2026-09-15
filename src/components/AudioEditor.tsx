import { useEffect, useMemo, useRef, useState } from 'react'
import type { AudioEditSpec, MediaLibraryEntry } from '../api'
import {
  FADE_CURVES,
  FADE_CURVE_LABELS,
  NORMALIZE_MODES,
  NORMALIZE_MODE_LABELS,
  defaultAudioEditSpec,
} from '../../electron/audioEditTypes'
import { buildFadeCurveSamples, computePeakGain, computeWaveformPeaks, type WaveformPeaks } from '../audioEditPreview'

// The Audio Editor (TODO.md's "solid waveform editor" tier, 2026-09-15) —
// opened via MediaLibraryCard's "✏️ Edit Audio" action. Non-destructive by
// construction: every action here either previews locally (Web Audio API,
// this file) or, on commit, asks the main process to render a brand-new
// audio asset via FFmpeg (electron/audioEditRenderer.ts) — the source file
// this component reads from is never opened for writing. Same split as
// PreviewPlayer.tsx's chroma-key preview: this file's playback approximates
// the real thing for instant interactive feedback; the FFmpeg render on
// commit is the authoritative result.

const MIN_PPS = 10
const MAX_PPS = 800
const WAVEFORM_HEIGHT = 140
const ENVELOPE_HEIGHT = 70
const ENVELOPE_MAX_GAIN = 2

interface Props {
  projectId: string
  entry: MediaLibraryEntry
  onClose: () => void
  onCommitted: () => void
}

interface Selection {
  start: number
  end: number
}

function fmt(seconds: number): string {
  return `${seconds.toFixed(2)}s`
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

export default function AudioEditor({ projectId, entry, onClose, onCommitted }: Props) {
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null)
  const [spec, setSpec] = useState<AudioEditSpec | null>(null)
  const [pixelsPerSecond, setPixelsPerSecond] = useState(80)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [playhead, setPlayhead] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)

  const [committing, setCommitting] = useState(false)
  const [commitError, setCommitError] = useState<string | null>(null)
  const [committed, setCommitted] = useState(false)

  const [splitTime, setSplitTime] = useState(0)
  const [splitting, setSplitting] = useState(false)
  const [splitError, setSplitError] = useState<string | null>(null)

  const audioCtxRef = useRef<AudioContext | null>(null)
  const sourceRef = useRef<AudioBufferSourceNode | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const waveformCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const envelopeCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const draggingSelectionRef = useRef(false)
  const draggingPointIndexRef = useRef<number | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setLoadError(null)
      try {
        const url = await window.api.getAssetMediaUrl(projectId, entry.id)
        const response = await fetch(url)
        const arrayBuffer = await response.arrayBuffer()
        const ctx = new AudioContext()
        audioCtxRef.current = ctx
        const buffer = await ctx.decodeAudioData(arrayBuffer)
        if (cancelled) return
        setAudioBuffer(buffer)
        setSpec(defaultAudioEditSpec(buffer.duration))
        setSplitTime(buffer.duration / 2)
        setPixelsPerSecond(clamp(700 / Math.max(buffer.duration, 0.01), MIN_PPS, MAX_PPS))
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
      stopPlayback()
      audioCtxRef.current?.close().catch(() => {})
      audioCtxRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, entry.id])

  const peaks: WaveformPeaks | null = useMemo(
    () => (audioBuffer ? computeWaveformPeaks(audioBuffer, pixelsPerSecond) : null),
    [audioBuffer, pixelsPerSecond],
  )

  const duration = audioBuffer?.duration ?? 0
  const trimmedDuration = spec ? Math.max(0, spec.trimEnd - spec.trimStart) : 0
  const canvasWidth = Math.max(1, Math.round(duration * pixelsPerSecond))

  // --- Waveform drawing --------------------------------------------------

  useEffect(() => {
    const canvas = waveformCanvasRef.current
    if (!canvas || !peaks || !spec) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const styles = getComputedStyle(canvas)
    const bg = styles.getPropertyValue('--bg').trim() || '#12141a'
    const waveColor = styles.getPropertyValue('--text-muted').trim() || '#888'
    const keptColor = styles.getPropertyValue('--accent').trim() || '#4da3ff'

    ctx.clearRect(0, 0, canvasWidth, WAVEFORM_HEIGHT)
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, canvasWidth, WAVEFORM_HEIGHT)

    const mid = WAVEFORM_HEIGHT / 2
    for (let x = 0; x < peaks.min.length; x++) {
      const t = x / pixelsPerSecond
      const kept = t >= spec.trimStart && t <= spec.trimEnd
      ctx.strokeStyle = kept ? keptColor : waveColor
      ctx.globalAlpha = kept ? 1 : 0.35
      const y1 = mid + peaks.min[x] * mid
      const y2 = mid + peaks.max[x] * mid
      ctx.beginPath()
      ctx.moveTo(x + 0.5, y1)
      ctx.lineTo(x + 0.5, y2)
      ctx.stroke()
    }
    ctx.globalAlpha = 1

    if (selection) {
      const x1 = Math.min(selection.start, selection.end) * pixelsPerSecond
      const x2 = Math.max(selection.start, selection.end) * pixelsPerSecond
      ctx.fillStyle = 'rgba(255, 200, 80, 0.2)'
      ctx.fillRect(x1, 0, x2 - x1, WAVEFORM_HEIGHT)
      ctx.strokeStyle = 'rgba(255, 200, 80, 0.8)'
      ctx.strokeRect(x1, 0, x2 - x1, WAVEFORM_HEIGHT)
    }

    ctx.strokeStyle = '#ffffff'
    ctx.beginPath()
    ctx.moveTo(playhead * pixelsPerSecond, 0)
    ctx.lineTo(playhead * pixelsPerSecond, WAVEFORM_HEIGHT)
    ctx.stroke()
  }, [peaks, pixelsPerSecond, canvasWidth, spec, selection, playhead])

  // --- Envelope strip drawing ---------------------------------------------

  useEffect(() => {
    const canvas = envelopeCanvasRef.current
    if (!canvas || !spec) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvasWidth, ENVELOPE_HEIGHT)
    ctx.fillStyle = 'rgba(255,255,255,0.03)'
    ctx.fillRect(0, 0, canvasWidth, ENVELOPE_HEIGHT)

    const gainToY = (gain: number) => ENVELOPE_HEIGHT - (gain / ENVELOPE_MAX_GAIN) * ENVELOPE_HEIGHT
    // unity-gain reference line
    ctx.strokeStyle = 'rgba(255,255,255,0.15)'
    ctx.setLineDash([4, 4])
    ctx.beginPath()
    ctx.moveTo(0, gainToY(1))
    ctx.lineTo(canvasWidth, gainToY(1))
    ctx.stroke()
    ctx.setLineDash([])

    if (spec.envelope.length === 0) {
      ctx.strokeStyle = 'rgba(255,255,255,0.4)'
      ctx.beginPath()
      ctx.moveTo(0, gainToY(1))
      ctx.lineTo(canvasWidth, gainToY(1))
      ctx.stroke()
    } else {
      const sorted = [...spec.envelope].sort((a, b) => a.time - b.time)
      ctx.strokeStyle = '#4da3ff'
      ctx.beginPath()
      ctx.moveTo(0, gainToY(sorted[0].gain))
      for (const p of sorted) ctx.lineTo(p.time * pixelsPerSecond, gainToY(p.gain))
      ctx.lineTo(canvasWidth, gainToY(sorted[sorted.length - 1].gain))
      ctx.stroke()

      for (const p of sorted) {
        ctx.fillStyle = '#4da3ff'
        ctx.beginPath()
        ctx.arc(p.time * pixelsPerSecond, gainToY(p.gain), 5, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }, [spec, canvasWidth, pixelsPerSecond])

  // --- Interaction: waveform range selection ------------------------------

  function timeFromClientX(clientX: number): number {
    const canvas = waveformCanvasRef.current
    if (!canvas) return 0
    const rect = canvas.getBoundingClientRect()
    return clamp((clientX - rect.left) / pixelsPerSecond, 0, duration)
  }

  function handleWaveformMouseDown(e: React.MouseEvent) {
    const t = timeFromClientX(e.clientX)
    draggingSelectionRef.current = true
    setSelection({ start: t, end: t })
    setPlayhead(t)
  }

  function handleWaveformMouseMove(e: React.MouseEvent) {
    if (!draggingSelectionRef.current) return
    const t = timeFromClientX(e.clientX)
    setSelection((sel) => (sel ? { ...sel, end: t } : { start: t, end: t }))
  }

  function handleWaveformMouseUp() {
    draggingSelectionRef.current = false
    setSelection((sel) => {
      if (!sel) return sel
      if (Math.abs(sel.end - sel.start) < 0.05) return null
      return { start: Math.min(sel.start, sel.end), end: Math.max(sel.start, sel.end) }
    })
  }

  // --- Interaction: envelope points ---------------------------------------

  function envelopePointAt(clientX: number, clientY: number): number | null {
    const canvas = envelopeCanvasRef.current
    if (!canvas || !spec) return null
    const rect = canvas.getBoundingClientRect()
    const x = clientX - rect.left
    const y = clientY - rect.top
    const gainToY = (gain: number) => ENVELOPE_HEIGHT - (gain / ENVELOPE_MAX_GAIN) * ENVELOPE_HEIGHT
    for (let i = 0; i < spec.envelope.length; i++) {
      const p = spec.envelope[i]
      const dx = p.time * pixelsPerSecond - x
      const dy = gainToY(p.gain) - y
      if (Math.sqrt(dx * dx + dy * dy) <= 8) return i
    }
    return null
  }

  function updatePointFromClient(index: number, clientX: number, clientY: number) {
    const canvas = envelopeCanvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const time = clamp((clientX - rect.left) / pixelsPerSecond, 0, trimmedDuration)
    const gain = clamp(ENVELOPE_MAX_GAIN * (1 - (clientY - rect.top) / ENVELOPE_HEIGHT), 0, ENVELOPE_MAX_GAIN)
    setSpec((s) => {
      if (!s) return s
      const envelope = [...s.envelope]
      envelope[index] = { time, gain }
      return { ...s, envelope }
    })
  }

  function handleEnvelopeMouseDown(e: React.MouseEvent) {
    const hit = envelopePointAt(e.clientX, e.clientY)
    if (hit !== null) {
      draggingPointIndexRef.current = hit
      return
    }
    // Add a new point where clicked, then start dragging it immediately.
    const canvas = envelopeCanvasRef.current
    if (!canvas || !spec) return
    const rect = canvas.getBoundingClientRect()
    const time = clamp((e.clientX - rect.left) / pixelsPerSecond, 0, trimmedDuration)
    const gain = clamp(ENVELOPE_MAX_GAIN * (1 - (e.clientY - rect.top) / ENVELOPE_HEIGHT), 0, ENVELOPE_MAX_GAIN)
    setSpec((s) => (s ? { ...s, envelope: [...s.envelope, { time, gain }] } : s))
    draggingPointIndexRef.current = spec.envelope.length
  }

  function handleEnvelopeMouseMove(e: React.MouseEvent) {
    if (draggingPointIndexRef.current === null) return
    updatePointFromClient(draggingPointIndexRef.current, e.clientX, e.clientY)
  }

  function handleEnvelopeMouseUp() {
    draggingPointIndexRef.current = null
  }

  function removeEnvelopePoint(index: number) {
    setSpec((s) => (s ? { ...s, envelope: s.envelope.filter((_, i) => i !== index) } : s))
  }

  function addEnvelopePointAtPlayhead() {
    if (!spec) return
    const time = clamp(playhead - spec.trimStart, 0, trimmedDuration)
    setSpec((s) => (s ? { ...s, envelope: [...s.envelope, { time, gain: 1 }] } : s))
  }

  // --- Playback ------------------------------------------------------------

  function stopPlayback() {
    if (sourceRef.current) {
      try {
        sourceRef.current.stop()
      } catch {
        // already stopped
      }
      sourceRef.current.disconnect()
      sourceRef.current = null
    }
    setIsPlaying(false)
  }

  function play() {
    if (!audioBuffer || !spec) return
    stopPlayback()
    const ctx = audioCtxRef.current ?? new AudioContext()
    audioCtxRef.current = ctx

    const source = ctx.createBufferSource()
    source.buffer = audioBuffer
    const gainFades = ctx.createGain()
    const gainEnvelope = ctx.createGain()
    const gainNormalize = ctx.createGain()
    source.connect(gainFades).connect(gainEnvelope).connect(gainNormalize).connect(ctx.destination)

    const now = ctx.currentTime + 0.06
    const dur = Math.max(0.01, trimmedDuration)

    // Fades — scaled down proportionally if they'd overlap (preview-only
    // safeguard so Web Audio's setValueCurveAtTime scheduling never sees two
    // overlapping windows on the same param, which it rejects). The
    // committed FFmpeg render applies the durations exactly as specified.
    let fadeIn = spec.fadeInDuration
    let fadeOut = spec.fadeOutDuration
    if (fadeIn + fadeOut > dur && fadeIn + fadeOut > 0) {
      const scale = dur / (fadeIn + fadeOut)
      fadeIn *= scale
      fadeOut *= scale
    }
    gainFades.gain.setValueAtTime(1, now)
    if (fadeIn > 0.005) gainFades.gain.setValueCurveAtTime(buildFadeCurveSamples(spec.fadeInCurve, 'in'), now, fadeIn)
    if (fadeOut > 0.005) gainFades.gain.setValueCurveAtTime(buildFadeCurveSamples(spec.fadeOutCurve, 'out'), now + dur - fadeOut, fadeOut)

    if (spec.envelope.length > 0) {
      const sorted = [...spec.envelope].sort((a, b) => a.time - b.time)
      gainEnvelope.gain.setValueAtTime(sorted[0].gain, now)
      for (const p of sorted) {
        gainEnvelope.gain.linearRampToValueAtTime(p.gain, now + clamp(p.time, 0, dur))
      }
    } else {
      gainEnvelope.gain.setValueAtTime(1, now)
    }

    const normGain = spec.normalizeMode === 'peak' ? computePeakGain(audioBuffer, spec.trimStart, spec.trimEnd) : 1
    gainNormalize.gain.setValueAtTime(normGain, now)

    source.start(now, spec.trimStart, dur)
    sourceRef.current = source
    source.onended = () => setIsPlaying(false)
    setIsPlaying(true)
  }

  // --- Commit / Split --------------------------------------------------------

  async function handleCommit() {
    if (!spec) return
    setCommitting(true)
    setCommitError(null)
    setCommitted(false)
    try {
      await window.api.commitAudioEdit(projectId, entry.id, spec)
      setCommitted(true)
      onCommitted()
    } catch (err) {
      setCommitError(err instanceof Error ? err.message : String(err))
    } finally {
      setCommitting(false)
    }
  }

  async function handleSplit() {
    setSplitting(true)
    setSplitError(null)
    try {
      await window.api.splitAudioAsset(projectId, entry.id, splitTime)
      onCommitted()
      onClose()
    } catch (err) {
      setSplitError(err instanceof Error ? err.message : String(err))
    } finally {
      setSplitting(false)
    }
  }

  const envelopeWarning = trimmedDuration > 0 && spec && spec.envelope.some((p) => p.time > trimmedDuration)

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal--wide audio-editor" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h3>✏️ Edit Audio — {entry.originalName}</h3>
          <button className="btn" onClick={onClose}>
            ×
          </button>
        </div>

        {loading && <p className="muted">Loading and decoding audio…</p>}
        {loadError && <div className="error-banner">{loadError}</div>}

        {!loading && audioBuffer && spec && (
          <div className="audio-editor__body">
            <p className="muted">
              Non-destructive: committing below always creates a new audio asset — {entry.originalName} itself is
              never modified.
            </p>

            <div className="audio-editor__toolbar">
              <button className="btn" onClick={() => setPixelsPerSecond((p) => clamp(p / 1.5, MIN_PPS, MAX_PPS))}>
                Zoom −
              </button>
              <button className="btn" onClick={() => setPixelsPerSecond((p) => clamp(p * 1.5, MIN_PPS, MAX_PPS))}>
                Zoom +
              </button>
              <button className="btn" onClick={isPlaying ? stopPlayback : play}>
                {isPlaying ? '⏹ Stop' : '▶ Play'}
              </button>
              <span className="muted">
                Playhead {fmt(playhead)} · Clip {fmt(duration)} · Kept range {fmt(spec.trimStart)}–{fmt(spec.trimEnd)} (
                {fmt(trimmedDuration)})
              </span>
            </div>

            <div className="audio-editor__scroll" ref={scrollRef}>
              <canvas
                ref={waveformCanvasRef}
                width={canvasWidth}
                height={WAVEFORM_HEIGHT}
                className="audio-editor__waveform"
                onMouseDown={handleWaveformMouseDown}
                onMouseMove={handleWaveformMouseMove}
                onMouseUp={handleWaveformMouseUp}
                onMouseLeave={handleWaveformMouseUp}
              />
              <canvas
                ref={envelopeCanvasRef}
                width={canvasWidth}
                height={ENVELOPE_HEIGHT}
                className="audio-editor__envelope-strip"
                onMouseDown={handleEnvelopeMouseDown}
                onMouseMove={handleEnvelopeMouseMove}
                onMouseUp={handleEnvelopeMouseUp}
                onMouseLeave={handleEnvelopeMouseUp}
              />
            </div>
            <p className="clip-inspector__hint muted">
              Waveform: click-drag to select a range. Envelope strip below it: click to add a volume point, drag a
              point to move it.
            </p>

            <div className="audio-editor__columns">
              <div className="audio-editor__column">
                <div className="clip-inspector__section">
                  <h4>Trim</h4>
                  <div className="clip-inspector__row">
                    <label className="clip-inspector__field">
                      <span>Start (s)</span>
                      <input
                        type="number"
                        min={0}
                        max={spec.trimEnd}
                        step={0.05}
                        value={spec.trimStart.toFixed(2)}
                        onChange={(e) => setSpec({ ...spec, trimStart: clamp(Number(e.target.value) || 0, 0, spec.trimEnd) })}
                      />
                    </label>
                    <label className="clip-inspector__field">
                      <span>End (s)</span>
                      <input
                        type="number"
                        min={spec.trimStart}
                        max={duration}
                        step={0.05}
                        value={spec.trimEnd.toFixed(2)}
                        onChange={(e) =>
                          setSpec({ ...spec, trimEnd: clamp(Number(e.target.value) || duration, spec.trimStart, duration) })
                        }
                      />
                    </label>
                  </div>
                  <div className="inline-form">
                    {selection && (
                      <button className="btn" onClick={() => setSpec({ ...spec, trimStart: selection.start, trimEnd: selection.end })}>
                        Trim to Selection ({fmt(selection.start)}–{fmt(selection.end)})
                      </button>
                    )}
                    <button className="btn" onClick={() => setSpec({ ...spec, trimStart: 0, trimEnd: duration })}>
                      Use Full Clip
                    </button>
                  </div>
                </div>

                <div className="clip-inspector__section">
                  <h4>Split</h4>
                  <p className="muted clip-inspector__hint">
                    Cuts this clip into two brand-new assets at the given point — the original is untouched.
                  </p>
                  <label className="clip-inspector__field">
                    <span>Split at (s)</span>
                    <input
                      type="number"
                      min={0}
                      max={duration}
                      step={0.05}
                      value={splitTime.toFixed(2)}
                      onChange={(e) => setSplitTime(clamp(Number(e.target.value) || 0, 0, duration))}
                    />
                  </label>
                  <div className="inline-form">
                    <button className="btn" disabled={splitting} onClick={() => setSplitTime(playhead)}>
                      Use Playhead ({fmt(playhead)})
                    </button>
                    <button className="btn" disabled={splitting || splitTime <= 0 || splitTime >= duration} onClick={handleSplit}>
                      {splitting ? 'Splitting…' : '✂ Split Into Two Assets'}
                    </button>
                  </div>
                  {splitError && <div className="error-banner">{splitError}</div>}
                </div>
              </div>

              <div className="audio-editor__column">
                <div className="clip-inspector__section">
                  <h4>Fade</h4>
                  <div className="clip-inspector__row">
                    <label className="clip-inspector__field">
                      <span>Fade in (s)</span>
                      <input
                        type="number"
                        min={0}
                        step={0.05}
                        value={spec.fadeInDuration.toFixed(2)}
                        onChange={(e) => setSpec({ ...spec, fadeInDuration: Math.max(0, Number(e.target.value) || 0) })}
                      />
                    </label>
                    <label className="clip-inspector__field">
                      <span>Curve</span>
                      <select
                        value={spec.fadeInCurve}
                        onChange={(e) => setSpec({ ...spec, fadeInCurve: e.target.value as AudioEditSpec['fadeInCurve'] })}
                      >
                        {FADE_CURVES.map((c) => (
                          <option key={c} value={c}>
                            {FADE_CURVE_LABELS[c]}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="clip-inspector__row">
                    <label className="clip-inspector__field">
                      <span>Fade out (s)</span>
                      <input
                        type="number"
                        min={0}
                        step={0.05}
                        value={spec.fadeOutDuration.toFixed(2)}
                        onChange={(e) => setSpec({ ...spec, fadeOutDuration: Math.max(0, Number(e.target.value) || 0) })}
                      />
                    </label>
                    <label className="clip-inspector__field">
                      <span>Curve</span>
                      <select
                        value={spec.fadeOutCurve}
                        onChange={(e) => setSpec({ ...spec, fadeOutCurve: e.target.value as AudioEditSpec['fadeOutCurve'] })}
                      >
                        {FADE_CURVES.map((c) => (
                          <option key={c} value={c}>
                            {FADE_CURVE_LABELS[c]}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                </div>

                <div className="clip-inspector__section">
                  <h4>Normalize</h4>
                  <label className="clip-inspector__field">
                    <span>Mode</span>
                    <select
                      value={spec.normalizeMode}
                      onChange={(e) => setSpec({ ...spec, normalizeMode: e.target.value as AudioEditSpec['normalizeMode'] })}
                    >
                      {NORMALIZE_MODES.map((m) => (
                        <option key={m} value={m}>
                          {NORMALIZE_MODE_LABELS[m]}
                        </option>
                      ))}
                    </select>
                  </label>
                  {spec.normalizeMode === 'loudness' && (
                    <p className="clip-inspector__hint muted">
                      Loudness normalization is analyzed by FFmpeg on commit — the live preview plays unnormalized for
                      this mode.
                    </p>
                  )}
                </div>
              </div>
            </div>

            <div className="clip-inspector__section">
              <h4>Volume Envelope</h4>
              {spec.envelope.length === 0 ? (
                <p className="muted clip-inspector__hint">Flat — no automation points yet.</p>
              ) : (
                <div className="audio-editor__envelope-list">
                  {[...spec.envelope]
                    .map((p, i) => ({ p, i }))
                    .sort((a, b) => a.p.time - b.p.time)
                    .map(({ p, i }) => (
                      <div key={i} className="clip-inspector__row audio-editor__envelope-row">
                        <label className="clip-inspector__field">
                          <span>Time (s)</span>
                          <input
                            type="number"
                            min={0}
                            max={trimmedDuration}
                            step={0.05}
                            value={p.time.toFixed(2)}
                            onChange={(e) => {
                              const envelope = [...spec.envelope]
                              envelope[i] = { ...envelope[i], time: clamp(Number(e.target.value) || 0, 0, trimmedDuration) }
                              setSpec({ ...spec, envelope })
                            }}
                          />
                        </label>
                        <label className="clip-inspector__field">
                          <span>Gain (0–2)</span>
                          <input
                            type="number"
                            min={0}
                            max={ENVELOPE_MAX_GAIN}
                            step={0.05}
                            value={p.gain.toFixed(2)}
                            onChange={(e) => {
                              const envelope = [...spec.envelope]
                              envelope[i] = { ...envelope[i], gain: clamp(Number(e.target.value) || 0, 0, ENVELOPE_MAX_GAIN) }
                              setSpec({ ...spec, envelope })
                            }}
                          />
                        </label>
                        <button className="btn btn--danger" onClick={() => removeEnvelopePoint(i)}>
                          Remove
                        </button>
                      </div>
                    ))}
                </div>
              )}
              {envelopeWarning && (
                <p className="clip-inspector__hint" style={{ color: 'var(--danger)' }}>
                  One or more points fall outside the current trim range and will be clamped on render.
                </p>
              )}
              <div className="inline-form">
                <button className="btn" onClick={addEnvelopePointAtPlayhead}>
                  + Add Point at Playhead
                </button>
                {spec.envelope.length > 0 && (
                  <button className="btn" onClick={() => setSpec({ ...spec, envelope: [] })}>
                    Clear Envelope
                  </button>
                )}
              </div>
            </div>

            {commitError && <div className="error-banner">{commitError}</div>}
            {committed && !committing && (
              <div className="export-progress">
                <p>✅ Saved as a new audio asset — it now shows up in this project's Media Library and Assets tab.</p>
              </div>
            )}
          </div>
        )}

        <div className="modal__actions">
          <button className="btn" onClick={onClose}>
            Close
          </button>
          {audioBuffer && spec && (
            <button className="btn btn--primary" disabled={committing || !(spec.trimEnd > spec.trimStart)} onClick={handleCommit}>
              {committing ? 'Rendering…' : '💾 Save as New Asset'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
