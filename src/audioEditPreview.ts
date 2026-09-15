// Pure Web Audio helpers for the Audio Editor's live, interactive preview
// (AudioEditor.tsx) — the "instant feedback while tuning" half of the split
// TODO.md asks this feature to reuse from chroma key: a real-time JS
// approximation for scrubbing/tuning, with the FFmpeg render
// (audioEditRenderer.ts) as the authoritative committed output. No DOM/
// Electron imports, so this stays trivially unit-testable and mirrors
// src/chromaKey.ts's "small pure module, verified where practical" shape.
//
// Fade curve shapes below are a good-faith reproduction of the general
// *shape* of FFmpeg's named `afade` curves (linear/sine/logarithmic/
// power-law families) — unlike chromaKey.ts, this has NOT been pixel/sample
// verified against real FFmpeg output byte-for-byte (that would need a
// dedicated comparison script decoding real rendered audio, which felt like
// more rigor than a preview-only approximation warrants here). Getting the
// *duration* and *envelope* exactly right (both are plain linear math, and
// both this preview and audioEditRenderer.ts use the same linear-ramp
// formula) matters far more for trusting the preview than the fade curve's
// exact bend, and that part IS exact. Treat any curve mismatch between
// preview and committed render as a cosmetic approximation, not a bug —
// the render is always what actually gets saved.

import type { EnvelopePoint, FadeCurve } from '../electron/audioEditTypes'

/** Fade-IN shape: 0 at t=0, 1 at t=1, t clamped to [0,1]. Fade-out reuses this mirrored (see buildFadeCurveSamples). */
export function fadeCurveValue(curve: FadeCurve, t: number): number {
  const x = Math.max(0, Math.min(1, t))
  switch (curve) {
    case 'tri':
      return x
    case 'qsin':
      return Math.sin((x * Math.PI) / 2)
    case 'hsin':
      return (1 - Math.cos(x * Math.PI)) / 2
    case 'log':
      return Math.pow(0.1, (1 - x) * 5)
    case 'par':
      return 1 - (1 - x) * (1 - x)
    case 'qua':
      return x * x
    case 'cub':
      return x * x * x
    case 'squ':
      return Math.sqrt(x)
    default:
      return x
  }
}

/**
 * Samples a fade curve into a Float32Array suitable for
 * `AudioParam.setValueCurveAtTime` — `direction: 'in'` ramps 0->1,
 * `'out'` ramps 1->0. `sampleCount` of ~50 is plenty smooth for a gain
 * envelope (unlike audio itself, gain curves don't need audio-rate
 * resolution).
 */
export function buildFadeCurveSamples(curve: FadeCurve, direction: 'in' | 'out', sampleCount = 50): Float32Array {
  const samples = new Float32Array(Math.max(2, sampleCount))
  for (let i = 0; i < samples.length; i++) {
    const t = i / (samples.length - 1)
    const v = fadeCurveValue(curve, t)
    samples[i] = direction === 'in' ? v : 1 - v
  }
  return samples
}

/** Linear-interpolated envelope gain at time `t` (seconds since the trimmed clip's own start) — used to draw the envelope overlay, not for scheduling (the live preview schedules real linearRampToValueAtTime automation instead, see AudioEditor.tsx). */
export function envelopeGainAt(points: EnvelopePoint[], t: number): number {
  if (points.length === 0) return 1
  const sorted = [...points].sort((a, b) => a.time - b.time)
  if (t <= sorted[0].time) return sorted[0].gain
  if (t >= sorted[sorted.length - 1].time) return sorted[sorted.length - 1].gain
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]
    const b = sorted[i + 1]
    if (t >= a.time && t <= b.time) {
      const span = b.time - a.time
      return span <= 0.0001 ? a.gain : a.gain + (b.gain - a.gain) * ((t - a.time) / span)
    }
  }
  return 1
}

/**
 * Linear gain multiplier that would bring the loudest sample in
 * `[trimStart, trimEnd)` to exactly 0 dBFS (amplitude 1.0) — computed
 * directly from the decoded PCM, which is why the preview's "Peak" mode
 * needs no round-trip to FFmpeg the way the committed render's peak
 * measurement pass does (audioEditRenderer.ts's `measurePeakDb`): the whole
 * point of decoding via Web Audio here is that the exact samples are
 * already in memory.
 */
export function computePeakGain(buffer: AudioBuffer, trimStart: number, trimEnd: number): number {
  const startSample = Math.max(0, Math.floor(trimStart * buffer.sampleRate))
  const endSample = Math.min(buffer.length, Math.ceil(trimEnd * buffer.sampleRate))
  let peak = 0
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch)
    for (let i = startSample; i < endSample; i++) {
      const abs = Math.abs(data[i])
      if (abs > peak) peak = abs
    }
  }
  if (peak <= 0.0001) return 1
  return Math.min(20, 1 / peak)
}

/** Min/max sample pairs per pixel column, for drawing a waveform without redrawing from raw PCM on every zoom/scroll tick. */
export interface WaveformPeaks {
  min: Float32Array
  max: Float32Array
}

/** Downsamples a decoded buffer's (mixed-to-mono) samples into one min/max pair per output column, at `pixelsPerSecond` resolution. */
export function computeWaveformPeaks(buffer: AudioBuffer, pixelsPerSecond: number): WaveformPeaks {
  const totalColumns = Math.max(1, Math.ceil(buffer.duration * pixelsPerSecond))
  const min = new Float32Array(totalColumns)
  const max = new Float32Array(totalColumns)
  const samplesPerColumn = buffer.length / totalColumns
  const channelData: Float32Array[] = []
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) channelData.push(buffer.getChannelData(ch))

  for (let col = 0; col < totalColumns; col++) {
    const start = Math.floor(col * samplesPerColumn)
    const end = Math.max(start + 1, Math.floor((col + 1) * samplesPerColumn))
    let colMin = 1
    let colMax = -1
    for (let i = start; i < end && i < buffer.length; i++) {
      let mixed = 0
      for (const data of channelData) mixed += data[i]
      mixed /= channelData.length
      if (mixed < colMin) colMin = mixed
      if (mixed > colMax) colMax = mixed
    }
    if (colMin > colMax) {
      colMin = 0
      colMax = 0
    }
    min[col] = colMin
    max[col] = colMax
  }
  return { min, max }
}
