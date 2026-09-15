import { useEffect, useMemo, useRef, useState } from 'react'
import type { AudioEditSpec, MediaLibraryEntry } from '../api'
import {
  FADE_CURVES,
  FADE_CURVE_LABELS,
  NORMALIZE_MODES,
  NORMALIZE_MODE_LABELS,
  defaultAudioEditSpec,
} from '../../electron/audioEditTypes'
import {
  buildFadeCurveSamples,
  computePeakGain,
  computeWaveformPeaks,
  computeEffectiveClipped,
  sliceCurveFrom,
  envelopeGainAt,
  dbToAmplitude,
  DB_GRIDLINE_LEVELS,
  CLIP_THRESHOLD,
  type WaveformPeaks,
} from '../audioEditPreview'

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
const TIME_AXIS_HEIGHT = 22
const ENVELOPE_MAX_GAIN = 2
const DB_AXIS_WIDTH = 44
// A plain click (no meaningful pointer movement) seeks; anything past this
// travels far enough to count as a drag-select instead, per the 2026-09-15
// ask to only seek on "a plain click (not a drag)."
const CLICK_DRAG_THRESHOLD_PX = 3

// Zooming in on a long file used to let `canvasWidth` (duration ×
// pixelsPerSecond) grow unbounded — for Dan's real 230.16s file at the old
// MAX_PPS ceiling of 800, that's 184,128px wide. Blink's hard per-axis
// canvas-element limit is 65,535px, and canvases are GPU-texture-backed by
// default (this component never passes `willReadFrequently`), so a width
// that far past it can fail GPU texture allocation outright — which is
// exactly the real "Aw, Snap!" renderer crash Dan hit, not a theoretical
// one. MAX_CANVAS_WIDTH stays comfortably under both that hard 65,535 limit
// AND the lowest max-texture-size commonly seen on real (especially older/
// integrated) GPUs (8,192) — so this holds regardless of which GPU the
// renderer process ends up on. The zoom UI clamps to this rather than
// letting the canvas grow past it and hoping the browser degrades
// gracefully, per the explicit ask: stop zoom-in at a safe maximum instead.
const MAX_CANVAS_WIDTH = 8000

function maxPixelsPerSecondFor(duration: number): number {
  return clamp(Math.floor(MAX_CANVAS_WIDTH / Math.max(duration, 0.001)), MIN_PPS, MAX_PPS)
}

// Adaptive time-axis tick spacing: the smallest of these whose on-screen
// spacing (interval × pixelsPerSecond) is still legible, so ticks land every
// ~10s zoomed out and as tight as ~0.1s zoomed all the way in, per the ask.
const TICK_INTERVALS_SECONDS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600]
const MIN_TICK_SPACING_PX = 60

function pickTickInterval(pixelsPerSecond: number): number {
  for (const interval of TICK_INTERVALS_SECONDS) {
    if (interval * pixelsPerSecond >= MIN_TICK_SPACING_PX) return interval
  }
  return TICK_INTERVALS_SECONDS[TICK_INTERVALS_SECONDS.length - 1]
}

/** mm:ss (or h:mm:ss past an hour) — decimals only shown once ticks are sub-second apart, since whole seconds are all a normal edit needs. */
function formatAxisTime(seconds: number, showDecimal: boolean): string {
  const total = Math.max(0, seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const secStr = showDecimal ? s.toFixed(1).padStart(4, '0') : Math.round(s).toString().padStart(2, '0')
  const mStr = h > 0 ? m.toString().padStart(2, '0') : m.toString()
  return h > 0 ? `${h}:${mStr}:${secStr}` : `${mStr}:${secStr}`
}

/** y-offsets from the waveform's vertical center for each dB gridline, both above and below center (amplitude is symmetric around silence). */
function dbGridlineOffsets(): { db: number; offsetPx: number }[] {
  return DB_GRIDLINE_LEVELS.map((db) => ({ db, offsetPx: dbToAmplitude(db) * (WAVEFORM_HEIGHT / 2) }))
}

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

  const [selectedPointIndex, setSelectedPointIndex] = useState<number | null>(null)

  const audioCtxRef = useRef<AudioContext | null>(null)
  const sourceRef = useRef<AudioBufferSourceNode | null>(null)
  const rafRef = useRef<number | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const timeAxisCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const waveformCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const envelopeCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const dbAxisCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const draggingSelectionRef = useRef(false)
  const draggingPointIndexRef = useRef<number | null>(null)
  const clickStartRef = useRef<{ clientX: number; t: number } | null>(null)

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
        setSelectedPointIndex(null)
        setPixelsPerSecond(clamp(700 / Math.max(buffer.duration, 0.01), MIN_PPS, maxPixelsPerSecondFor(buffer.duration)))
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

  // Edit-aware clipping (item 5, 2026-09-15): reflects the volume envelope
  // actually pushing a sample over full scale, on top of computeWaveformPeaks'
  // source-only clip flag — see computeEffectiveClipped's header comment.
  const effectiveClipped: Uint8Array | null = useMemo(
    () => (peaks && spec ? computeEffectiveClipped(peaks, pixelsPerSecond, spec.trimStart, spec.trimEnd, spec.envelope) : null),
    [peaks, pixelsPerSecond, spec?.trimStart, spec?.trimEnd, spec?.envelope],
  )

  const duration = audioBuffer?.duration ?? 0
  const trimmedDuration = spec ? Math.max(0, spec.trimEnd - spec.trimStart) : 0
  const canvasWidth = Math.max(1, Math.round(duration * pixelsPerSecond))
  const maxPixelsPerSecond = useMemo(() => maxPixelsPerSecondFor(duration), [duration])
  const atMaxZoom = pixelsPerSecond >= maxPixelsPerSecond - 0.001

  // --- Time axis drawing ---------------------------------------------------

  useEffect(() => {
    const canvas = timeAxisCanvasRef.current
    if (!canvas || !audioBuffer) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const styles = getComputedStyle(canvas)
    const bg = styles.getPropertyValue('--bg').trim() || '#12141a'
    const textColor = styles.getPropertyValue('--text-muted').trim() || '#888'
    const tickColor = styles.getPropertyValue('--border').trim() || '#2c303a'

    ctx.clearRect(0, 0, canvasWidth, TIME_AXIS_HEIGHT)
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, canvasWidth, TIME_AXIS_HEIGHT)

    const interval = pickTickInterval(pixelsPerSecond)
    const showDecimal = interval < 1
    const tickCount = Math.floor(duration / interval)

    ctx.font = '10px sans-serif'
    ctx.textBaseline = 'top'
    for (let i = 0; i <= tickCount; i++) {
      const t = i * interval
      const x = t * pixelsPerSecond
      ctx.strokeStyle = tickColor
      ctx.beginPath()
      ctx.moveTo(x + 0.5, TIME_AXIS_HEIGHT - 7)
      ctx.lineTo(x + 0.5, TIME_AXIS_HEIGHT)
      ctx.stroke()
      ctx.fillStyle = textColor
      ctx.fillText(formatAxisTime(t, showDecimal), x + 3, 2)
    }
  }, [audioBuffer, pixelsPerSecond, canvasWidth, duration])

  // --- dB axis drawing ------------------------------------------------------
  // A fixed-width column to the left of the scrolling waveform — unlike the
  // time axis, amplitude gridlines don't move with horizontal scroll/zoom, so
  // this lives outside `.audio-editor__scroll` entirely (see the JSX) rather
  // than scrolling alongside the waveform. One canvas spans the full stacked
  // height (time axis + waveform + envelope) so it lines up vertically with
  // all three, but only draws gridlines/labels within the waveform's span.

  useEffect(() => {
    const canvas = dbAxisCanvasRef.current
    if (!canvas || !audioBuffer) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const styles = getComputedStyle(canvas)
    const bg = styles.getPropertyValue('--bg').trim() || '#12141a'
    const textColor = styles.getPropertyValue('--text-muted').trim() || '#888'
    const gridColor = styles.getPropertyValue('--border').trim() || '#2c303a'
    const totalHeight = TIME_AXIS_HEIGHT + WAVEFORM_HEIGHT + ENVELOPE_HEIGHT

    ctx.clearRect(0, 0, DB_AXIS_WIDTH, totalHeight)
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, DB_AXIS_WIDTH, totalHeight)

    const mid = TIME_AXIS_HEIGHT + WAVEFORM_HEIGHT / 2
    ctx.font = '9px sans-serif'
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'right'
    for (const { db, offsetPx } of dbGridlineOffsets()) {
      for (const sign of [-1, 1]) {
        const y = mid + sign * offsetPx
        ctx.strokeStyle = gridColor
        ctx.beginPath()
        ctx.moveTo(DB_AXIS_WIDTH - 6, Math.round(y) + 0.5)
        ctx.lineTo(DB_AXIS_WIDTH, Math.round(y) + 0.5)
        ctx.stroke()
        ctx.fillStyle = textColor
        ctx.fillText(`${db}`, DB_AXIS_WIDTH - 8, y)
      }
    }
  }, [audioBuffer])

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
    const clipColor = styles.getPropertyValue('--danger').trim() || '#e05252'

    ctx.clearRect(0, 0, canvasWidth, WAVEFORM_HEIGHT)
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, canvasWidth, WAVEFORM_HEIGHT)

    const mid = WAVEFORM_HEIGHT / 2

    // Faint horizontal reference lines at the same dB levels the dB axis
    // column labels, so amplitude is readable directly against the waveform
    // and not just from the axis strip off to the side.
    const gridColor = styles.getPropertyValue('--border').trim() || '#2c303a'
    ctx.strokeStyle = gridColor
    ctx.globalAlpha = 0.5
    for (const { offsetPx } of dbGridlineOffsets()) {
      for (const sign of [-1, 1]) {
        const y = Math.round(mid + sign * offsetPx) + 0.5
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(canvasWidth, y)
        ctx.stroke()
      }
    }
    ctx.globalAlpha = 1

    for (let x = 0; x < peaks.min.length; x++) {
      const t = x / pixelsPerSecond
      const kept = t >= spec.trimStart && t <= spec.trimEnd
      // Red for either: the source sample itself already clips
      // (peaks.clipped), or the current volume envelope pushes it over full
      // scale (effectiveClipped) — e.g. dragging an envelope point's new
      // slider up past unity gain. Renders red regardless of kept/trimmed-
      // out state — it's a warning either about the source audio or about
      // the edit — but still dims along with the rest of the trimmed-out
      // region so a clipped, discarded stretch doesn't visually dominate
      // over the part that's actually being kept.
      const isClipped = peaks.clipped[x] === 1 || effectiveClipped?.[x] === 1
      ctx.strokeStyle = isClipped ? clipColor : kept ? keptColor : waveColor
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

    // Playhead — a real, visible line synced to actual playback position
    // (updated every animation frame while playing, see the play()/tick
    // loop below), plus a small triangular handle at the top so it reads
    // clearly even against a busy waveform.
    const px = playhead * pixelsPerSecond
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(px, 0)
    ctx.lineTo(px, WAVEFORM_HEIGHT)
    ctx.stroke()
    ctx.lineWidth = 1
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.moveTo(px - 5, 0)
    ctx.lineTo(px + 5, 0)
    ctx.lineTo(px, 7)
    ctx.closePath()
    ctx.fill()
  }, [peaks, effectiveClipped, pixelsPerSecond, canvasWidth, spec, selection, playhead])

  // Keep the playhead in view during playback, at any zoom level — without
  // this, playing past the edge of the visible (horizontally-scrolled)
  // window would make the "real-time" playhead invisible again.
  useEffect(() => {
    if (!isPlaying) return
    const container = scrollRef.current
    if (!container) return
    const x = playhead * pixelsPerSecond
    const left = container.scrollLeft
    const right = left + container.clientWidth
    if (x < left || x > right) {
      container.scrollLeft = Math.max(0, x - container.clientWidth / 2)
    }
  }, [playhead, isPlaying, pixelsPerSecond])

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
      const sorted = spec.envelope.map((p, i) => ({ p, i })).sort((a, b) => a.p.time - b.p.time)
      ctx.strokeStyle = '#4da3ff'
      ctx.beginPath()
      ctx.moveTo(0, gainToY(sorted[0].p.gain))
      for (const { p } of sorted) ctx.lineTo(p.time * pixelsPerSecond, gainToY(p.gain))
      ctx.lineTo(canvasWidth, gainToY(sorted[sorted.length - 1].p.gain))
      ctx.stroke()

      for (const { p, i } of sorted) {
        const selected = i === selectedPointIndex
        ctx.fillStyle = selected ? '#ffc850' : '#4da3ff'
        ctx.beginPath()
        ctx.arc(p.time * pixelsPerSecond, gainToY(p.gain), selected ? 7 : 5, 0, Math.PI * 2)
        ctx.fill()
        if (selected) {
          ctx.strokeStyle = '#ffffff'
          ctx.lineWidth = 1.5
          ctx.stroke()
        }
      }
    }
  }, [spec, canvasWidth, pixelsPerSecond, selectedPointIndex])

  // --- Interaction: waveform range selection ------------------------------
  // A plain click seeks the playhead (and clears any selection); a drag past
  // CLICK_DRAG_THRESHOLD_PX instead selects a trim range and leaves the
  // playhead untouched — distinguished in handleWaveformMouseUp by comparing
  // the mouseup position back against where the mousedown started.

  function timeFromClientX(clientX: number): number {
    const canvas = waveformCanvasRef.current
    if (!canvas) return 0
    const rect = canvas.getBoundingClientRect()
    return clamp((clientX - rect.left) / pixelsPerSecond, 0, duration)
  }

  function handleWaveformMouseDown(e: React.MouseEvent) {
    const t = timeFromClientX(e.clientX)
    clickStartRef.current = { clientX: e.clientX, t }
    draggingSelectionRef.current = true
    setSelection({ start: t, end: t })
  }

  function handleWaveformMouseMove(e: React.MouseEvent) {
    if (!draggingSelectionRef.current) return
    const t = timeFromClientX(e.clientX)
    setSelection((sel) => (sel ? { ...sel, end: t } : { start: t, end: t }))
  }

  function handleWaveformMouseUp(e: React.MouseEvent) {
    draggingSelectionRef.current = false
    const start = clickStartRef.current
    clickStartRef.current = null
    const movedPx = start ? Math.abs(e.clientX - start.clientX) : Infinity
    if (start && movedPx < CLICK_DRAG_THRESHOLD_PX) {
      // A plain click: seek the playhead there (and where the next Play
      // starts from — see play()), no lingering selection.
      setPlayhead(start.t)
      setSelection(null)
      return
    }
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
      setSelectedPointIndex(hit)
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
    setSelectedPointIndex(spec.envelope.length)
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
    setSelectedPointIndex((sel) => (sel === index ? null : sel))
  }

  function addEnvelopePointAtPlayhead() {
    if (!spec) return
    const time = clamp(playhead - spec.trimStart, 0, trimmedDuration)
    setSpec((s) => (s ? { ...s, envelope: [...s.envelope, { time, gain: 1 }] } : s))
    setSelectedPointIndex(spec.envelope.length)
  }

  function setSelectedPointGain(gain: number) {
    setSpec((s) => {
      if (!s || selectedPointIndex === null || !s.envelope[selectedPointIndex]) return s
      const envelope = [...s.envelope]
      envelope[selectedPointIndex] = { ...envelope[selectedPointIndex], gain: clamp(gain, 0, ENVELOPE_MAX_GAIN) }
      return { ...s, envelope }
    })
  }

  // --- Playback ------------------------------------------------------------

  function stopPlayback() {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    if (sourceRef.current) {
      // A manual stop shouldn't trigger the natural-completion handling in
      // play()'s own `onended` (which snaps the playhead to trimEnd) — that
      // handler is only for genuinely reaching the end of playback.
      sourceRef.current.onended = null
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

  // Plays from the current playhead position (click-to-seek's "sets where
  // the next Play starts from"), not always from trimStart — so fades and
  // the envelope are scheduled relative to how far into the trimmed window
  // that start point already is, continuing mid-fade/mid-ramp correctly
  // rather than restarting them from scratch.
  function play() {
    if (!audioBuffer || !spec) return
    stopPlayback()
    const ctx = audioCtxRef.current ?? new AudioContext()
    audioCtxRef.current = ctx

    const trimStart = spec.trimStart
    const trimEnd = spec.trimEnd
    const playFrom = clamp(playhead, trimStart, trimEnd)
    const remaining = trimEnd - playFrom
    if (remaining <= 0.001) return

    const source = ctx.createBufferSource()
    source.buffer = audioBuffer
    const gainFades = ctx.createGain()
    const gainEnvelope = ctx.createGain()
    const gainNormalize = ctx.createGain()
    source.connect(gainFades).connect(gainEnvelope).connect(gainNormalize).connect(ctx.destination)

    const now = ctx.currentTime + 0.06
    const dur = Math.max(0.01, trimEnd - trimStart)
    // How far `playFrom` already sits into the full trimmed window — 0 if
    // starting from the very beginning (the common case).
    const elapsed = playFrom - trimStart

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
    const fadeOutStart = dur - fadeOut

    gainFades.gain.setValueAtTime(1, now)
    if (fadeIn > 0.005 && elapsed < fadeIn) {
      // Starting inside the fade-in window: continue from wherever the
      // curve already is instead of restarting it from 0.
      const curve = sliceCurveFrom(buildFadeCurveSamples(spec.fadeInCurve, 'in'), elapsed / fadeIn)
      gainFades.gain.setValueAtTime(curve[0], now)
      gainFades.gain.setValueCurveAtTime(curve, now, fadeIn - elapsed)
    }
    if (fadeOut > 0.005) {
      if (elapsed < fadeOutStart) {
        gainFades.gain.setValueCurveAtTime(buildFadeCurveSamples(spec.fadeOutCurve, 'out'), now + (fadeOutStart - elapsed), fadeOut)
      } else {
        // Starting inside the fade-out window: same partial-curve handling.
        const curve = sliceCurveFrom(buildFadeCurveSamples(spec.fadeOutCurve, 'out'), (elapsed - fadeOutStart) / fadeOut)
        gainFades.gain.setValueAtTime(curve[0], now)
        gainFades.gain.setValueCurveAtTime(curve, now, fadeOut - (elapsed - fadeOutStart))
      }
    }

    if (spec.envelope.length > 0) {
      const sorted = [...spec.envelope].sort((a, b) => a.time - b.time)
      const startGain = envelopeGainAt(sorted, elapsed)
      gainEnvelope.gain.setValueAtTime(startGain, now)
      for (const p of sorted) {
        if (p.time <= elapsed) continue
        gainEnvelope.gain.linearRampToValueAtTime(p.gain, now + clamp(p.time - elapsed, 0, dur))
      }
    } else {
      gainEnvelope.gain.setValueAtTime(1, now)
    }

    const normGain = spec.normalizeMode === 'peak' ? computePeakGain(audioBuffer, trimStart, trimEnd) : 1
    gainNormalize.gain.setValueAtTime(normGain, now)

    source.start(now, playFrom, remaining)
    sourceRef.current = source
    source.onended = () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      sourceRef.current = null
      setIsPlaying(false)
      setPlayhead(trimEnd)
    }
    setIsPlaying(true)

    // Live playhead sync, driven by the AudioContext's own clock rather than
    // a fixed-interval timer, so it tracks actual playback exactly (matches
    // real audio scheduling drift/underrun behavior, not wall-clock time).
    const tick = () => {
      setPlayhead(clamp(playFrom + (ctx.currentTime - now), trimStart, trimEnd))
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
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
              <button className="btn" onClick={() => setPixelsPerSecond((p) => clamp(p / 1.5, MIN_PPS, maxPixelsPerSecond))}>
                Zoom −
              </button>
              <button
                className="btn"
                disabled={atMaxZoom}
                title={atMaxZoom ? "Maximum zoom for this file's length (avoids the canvas-crash bug on very wide waveforms)" : undefined}
                onClick={() => setPixelsPerSecond((p) => clamp(p * 1.5, MIN_PPS, maxPixelsPerSecond))}
              >
                Zoom +{atMaxZoom ? ' (max)' : ''}
              </button>
              <button className="btn" onClick={isPlaying ? stopPlayback : play}>
                {isPlaying ? '⏹ Stop' : '▶ Play'}
              </button>
              <span className="muted">
                Playhead {fmt(playhead)} · Clip {fmt(duration)} · Kept range {fmt(spec.trimStart)}–{fmt(spec.trimEnd)} (
                {fmt(trimmedDuration)})
              </span>
            </div>

            <div className="audio-editor__waveform-row">
              <canvas
                ref={dbAxisCanvasRef}
                width={DB_AXIS_WIDTH}
                height={TIME_AXIS_HEIGHT + WAVEFORM_HEIGHT + ENVELOPE_HEIGHT}
                className="audio-editor__db-axis"
              />
              <div className="audio-editor__scroll" ref={scrollRef}>
                <canvas ref={timeAxisCanvasRef} width={canvasWidth} height={TIME_AXIS_HEIGHT} className="audio-editor__time-axis" />
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
            </div>
            <p className="clip-inspector__hint muted">
              Waveform: click to seek the playhead (and set where the next ▶ Play starts from); click-drag to select
              a range instead — red highlights any sample at or above full scale (±{CLIP_THRESHOLD.toFixed(3)} / ~0
              dBFS), i.e. clipping, and the left-hand axis reads amplitude in dB. Envelope strip below it: click to
              add a volume point, drag a point to move it (or click a point once to select it, then use its slider
              below).
            </p>

            <div className="audio-editor__columns">
              <div className="audio-editor__column">
                <div className="clip-inspector__section">
                  <h4>Trim</h4>
                  <div className="clip-inspector__row">
                    <div className="audio-editor__field-with-slider">
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
                      <input
                        type="range"
                        className="audio-editor__slider"
                        min={0}
                        max={spec.trimEnd}
                        step={0.01}
                        value={spec.trimStart}
                        onChange={(e) => setSpec({ ...spec, trimStart: clamp(Number(e.target.value), 0, spec.trimEnd) })}
                      />
                    </div>
                    <div className="audio-editor__field-with-slider">
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
                      <input
                        type="range"
                        className="audio-editor__slider"
                        min={spec.trimStart}
                        max={duration}
                        step={0.01}
                        value={spec.trimEnd}
                        onChange={(e) => setSpec({ ...spec, trimEnd: clamp(Number(e.target.value), spec.trimStart, duration) })}
                      />
                    </div>
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
                  <div className="audio-editor__field-with-slider">
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
                    <input
                      type="range"
                      className="audio-editor__slider"
                      min={0}
                      max={duration}
                      step={0.01}
                      value={splitTime}
                      onChange={(e) => setSplitTime(clamp(Number(e.target.value), 0, duration))}
                    />
                  </div>
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
                    <div className="audio-editor__field-with-slider">
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
                      <input
                        type="range"
                        className="audio-editor__slider"
                        min={0}
                        max={Math.max(trimmedDuration, 0.01)}
                        step={0.01}
                        value={Math.min(spec.fadeInDuration, Math.max(trimmedDuration, 0.01))}
                        onChange={(e) => setSpec({ ...spec, fadeInDuration: Math.max(0, Number(e.target.value)) })}
                      />
                    </div>
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
                    <div className="audio-editor__field-with-slider">
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
                      <input
                        type="range"
                        className="audio-editor__slider"
                        min={0}
                        max={Math.max(trimmedDuration, 0.01)}
                        step={0.01}
                        value={Math.min(spec.fadeOutDuration, Math.max(trimmedDuration, 0.01))}
                        onChange={(e) => setSpec({ ...spec, fadeOutDuration: Math.max(0, Number(e.target.value)) })}
                      />
                    </div>
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
                      <div
                        key={i}
                        className={`clip-inspector__row audio-editor__envelope-row${
                          i === selectedPointIndex ? ' audio-editor__envelope-row--selected' : ''
                        }`}
                        onClick={() => setSelectedPointIndex(i)}
                      >
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
              {selectedPointIndex !== null && spec.envelope[selectedPointIndex] && (
                <div className="audio-editor__field-with-slider audio-editor__selected-point">
                  <span className="muted">
                    Selected point @ {fmt(spec.envelope[selectedPointIndex].time)} — Gain{' '}
                    {spec.envelope[selectedPointIndex].gain.toFixed(2)}
                    {spec.envelope[selectedPointIndex].gain >= 1 && (
                      <> ({(20 * Math.log10(spec.envelope[selectedPointIndex].gain)).toFixed(1)} dB)</>
                    )}
                  </span>
                  <input
                    type="range"
                    className="audio-editor__slider"
                    min={0}
                    max={ENVELOPE_MAX_GAIN}
                    step={0.01}
                    value={spec.envelope[selectedPointIndex].gain}
                    onChange={(e) => setSelectedPointGain(Number(e.target.value))}
                  />
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
                  <button
                    className="btn"
                    onClick={() => {
                      setSpec({ ...spec, envelope: [] })
                      setSelectedPointIndex(null)
                    }}
                  >
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
