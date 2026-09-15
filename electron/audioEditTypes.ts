// Deliberately has zero Node/Electron imports, same renderer-safe-import
// pattern as shotStatus.ts/sfxTypes.ts/editorTypes.ts: pure data (+ a couple
// of small pure helpers), safe for the renderer to import directly.
//
// This is the shape of one non-destructive Audio Editor edit (TODO.md's
// "solid waveform editor" tier — see audioEditRenderer.ts for how it's
// turned into a real FFmpeg command, and projectManager.ts's
// `commitAudioEdit`/`splitAudioAsset` for how the result becomes a new,
// separate audio asset rather than overwriting the source).

/**
 * A subset of FFmpeg's real `afade` filter curve shapes (see its docs for
 * the full list) — enough to give a genuinely different feel than a single
 * linear fade, without exposing all two dozen. Values are the literal
 * `curve=` names FFmpeg accepts, so audioEditRenderer.ts can pass them
 * straight through.
 */
export const FADE_CURVES = ['tri', 'qsin', 'hsin', 'log', 'par', 'qua', 'cub', 'squ'] as const
export type FadeCurve = (typeof FADE_CURVES)[number]

export const FADE_CURVE_LABELS: Record<FadeCurve, string> = {
  tri: 'Linear',
  qsin: 'Quarter Sine',
  hsin: 'Half Sine',
  log: 'Logarithmic',
  par: 'Parabola',
  qua: 'Quadratic',
  cub: 'Cubic',
  squ: 'Square Root',
}

/** One point of a volume-automation envelope. */
export interface EnvelopePoint {
  /** Seconds, relative to the *trimmed* output's own t=0 (i.e. after trimStart is applied). */
  time: number
  /** 0..2 gain multiplier — same units/range as editorTypes.ts's Clip.volume. */
  gain: number
}

export const NORMALIZE_MODES = ['none', 'peak', 'loudness'] as const
export type NormalizeMode = (typeof NORMALIZE_MODES)[number]

export const NORMALIZE_MODE_LABELS: Record<NormalizeMode, string> = {
  none: 'None',
  peak: 'Peak (bring the loudest sample to 0 dB)',
  loudness: 'Loudness (EBU R128, streaming-style)',
}

export interface AudioEditSpec {
  /** Seconds into the *source* file — start of the kept range. */
  trimStart: number
  /** Seconds into the *source* file — end of the kept range. */
  trimEnd: number
  fadeInDuration: number
  fadeInCurve: FadeCurve
  fadeOutDuration: number
  fadeOutCurve: FadeCurve
  /** Volume-automation envelope — empty means "no automation" (flat unity gain), not silence. */
  envelope: EnvelopePoint[]
  normalizeMode: NormalizeMode
}

export function defaultAudioEditSpec(durationSec: number): AudioEditSpec {
  return {
    trimStart: 0,
    trimEnd: durationSec,
    fadeInDuration: 0,
    fadeInCurve: 'tri',
    fadeOutDuration: 0,
    fadeOutCurve: 'tri',
    envelope: [],
    normalizeMode: 'none',
  }
}
