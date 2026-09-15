// Builds an FFmpeg command from a project's timeline (editorManager.ts) and
// runs it, producing real output files in the project's `exports/` folder —
// the only place in the app that ever synthesizes video, so all the "how do
// tracks/clips/transitions/chroma key/text overlays actually become a
// picture" logic lives here rather than being duplicated between this and
// the renderer's preview compositor (PreviewPlayer.tsx approximates the same
// rules for live playback, but this file is the authoritative renderer).
//
// --- The compositing model --------------------------------------------
//
// Every visual clip (a media clip on a video/overlay track, or a text clip)
// is first turned into its own self-contained RGBA stream, at full canvas
// size, with everything outside its `transform` box transparent — crop (of
// the source), scale+position (`transform`), chroma key, and fade-in/out
// (as an *alpha* fade, so lower layers show through) all happen inside that
// one per-clip filter chain, at the clip's own local time (0..duration).
// Adjacent same-track clips linked by a `transitionOut` are then folded
// together with `xfade` (video) / `acrossfade` (audio) into one combined
// unit *before* being placed on the global timeline — see `mergeTransitions`.
// Every remaining unit is time-shifted to its `startTime` and layered onto a
// background color canvas with `overlay=enable='between(t,start,end)'`,
// video tracks first (bottom to top by `order`), then overlay/text tracks on
// top of all video tracks (also bottom to top by `order`) — text is always
// above the footage, never interleavable with it; see editorManager.ts's
// header comment for why that's a deliberate simplification.
//
// Audio works the same way in parallel: every audio-bearing clip (an audio
// track clip, or a video-track clip with `includeAudio`) becomes its own
// trimmed/speed-adjusted/volume/fade audio stream, transition-merged the
// same way with `acrossfade`, delayed to its `startTime`, and mixed with
// every other one (plus a silent bed, so the output always has an audio
// stream) via `amix`.
//
// Deliberately not implemented this round: clip `rotation` (present in
// editorTypes.ts's `Transform` for forward-compatibility, always 0 here) —
// see TODO.md.
//
// --- Phase 7 — Export Tools ---------------------------------------------
//
// Everything below `prepareExport` (the visual/audio graph builders,
// `mergeTransitions`, `atempoChain`, `runFfmpeg`) is exactly the Phase 6
// code, untouched — Phase 7 didn't add new FFmpeg infrastructure, it just
// gave the existing MP4-export plumbing two new entry points:
//
//   - `exportMp4` grew an optional `range` parameter (seconds, on the full
//     timeline's own clock) that clips/shifts the timeline down to just that
//     window before building the graph — `exportClip` is a one-line wrapper
//     around exactly that, which is what makes "export just this selection
//     as its own MP4" a first-class feature without a second code path.
//   - `exportGif`/`exportStillFrame` reuse the same `prepareExport` (so they
//     get range-clamping, input resolution, and per-clip trim/crop/speed/
//     chroma-key/fade for free) and the same `buildVisualGraph` (so a GIF or
//     a still frame is composited exactly the same way the MP4 export
//     composites that instant), then bolt on their own format-specific tail
//     (palette generation for GIF, `-frames:v 1` for a still).
//
// A range that cuts through an active transition's overlap disables that
// transition on the clip it was clamped from, rather than attempting a
// partial blend against a partner clip that may now be excluded entirely —
// see `clampClipToRange`'s comment. Not expected to matter for the kind of
// short, deliberate selections a GIF/clip/still export is used for.

import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { ProjectManager, Asset } from './projectManager'
import type { EditorManager } from './editorManager'
import { probeMedia, probeMediaDiagnostics } from './mediaProbe'
import { ffmpegBinaryPath } from './videoRuntime'
import { requireProjectDir } from './projectPaths'
import type { Clip, Timeline, Track } from './editorTypes'

export interface ExportProgress {
  stage: 'preparing' | 'encoding' | 'done' | 'error'
  percent: number
  message?: string
}

/** A window on the full timeline's own clock (seconds), for exporting less than the whole thing. */
export interface ExportRange {
  start: number
  end: number
}

export type GifQuality = 'low' | 'medium' | 'high'

export interface GifExportOptions {
  range: ExportRange
  /** Output pixel dimensions — the caller (renderer) computes these, aspect-ratio math included. */
  width: number
  height: number
  fps: number
  quality: GifQuality
  /** true = loop forever, false = play once. */
  loop: boolean
}

export type StillImageFormat = 'png' | 'jpg'

export interface StillFrameOptions {
  /** The timeline position (seconds) to capture. */
  time: number
  format: StillImageFormat
}

const GIF_QUALITY_PARAMS: Record<GifQuality, { maxColors: number; dither: string }> = {
  low: { maxColors: 64, dither: 'bayer:bayer_scale=3' },
  medium: { maxColors: 128, dither: 'sierra2_4a' },
  high: { maxColors: 256, dither: 'sierra2_4a' },
}

interface ResolvedInput {
  clip: Clip
  asset: Asset
  absPath: string
  inputIndex: number
  hasAudio: boolean
}

interface Unit {
  label: string
  startTime: number
  duration: number
}

/** Everything the visual/audio graph builders need — see `prepareExport`. */
interface PreparedExport {
  dir: string
  timeline: Timeline
  /** Seconds — the export's own duration, already range-adjusted when a range was given. */
  totalDuration: number
  width: number
  height: number
  fps: number
  backgroundColor: string
  inputArgs: string[]
  resolvedByClipId: Map<string, ResolvedInput>
}

function hex(color: string): string {
  return `0x${color.replace('#', '')}`
}

function escapeDrawtext(text: string): string {
  // Sidesteps FFmpeg's notoriously two-layered filtergraph/drawtext quoting
  // by removing the one character (a literal `'`) that would otherwise need
  // it, rather than trying to escape it — see this file's header comment.
  return text.replace(/'/g, '’').replace(/\r\n|\r|\n/g, ' ')
}

function sortByOrder(tracks: Track[]): Track[] {
  return [...tracks].sort((a, b) => a.order - b.order)
}

function sanitizeOutputName(outputName: string, ext: string): string {
  const safe = outputName.trim().replace(/[\\/:*?"<>|]/g, '_') || `export-${randomUUID().slice(0, 8)}`
  return safe.toLowerCase().endsWith(`.${ext}`) ? safe : `${safe}.${ext}`
}

/**
 * Restricts a clip to the portion of it that falls within `range`, shifting
 * it onto the range's own clock (so the exported window's t=0 is
 * `range.start`) — null if the clip doesn't overlap the range at all. A clip
 * cut on either edge has its `transitionOut` cleared: the merge in
 * `mergeTransitions` pairs a clip with whatever immediately follows it by
 * exact start-time alignment, and a range boundary landing inside that
 * overlap window (rare — only a range chosen to cut mid-transition) would
 * otherwise risk pairing against a partner clip that got clamped or excluded
 * differently. Treating a clamped transition as "none" is a documented
 * simplification, not a bug: it only ever affects a range deliberately drawn
 * through an active transition's overlap.
 */
function clampClipToRange(clip: Clip, range: ExportRange): Clip | null {
  const clipEnd = clip.startTime + clip.duration
  if (clipEnd <= range.start || clip.startTime >= range.end) return null

  const frontCut = Math.max(0, range.start - clip.startTime)
  const backCut = Math.max(0, clipEnd - range.end)
  const newDuration = clip.duration - frontCut - backCut
  if (newDuration <= 0.01) return null

  const newStartTime = Math.max(clip.startTime, range.start) - range.start
  const truncated = frontCut > 0 || backCut > 0
  const transitionOut = truncated ? { type: 'none' as const, duration: clip.transitionOut.duration } : clip.transitionOut

  if (clip.kind === 'text') {
    return { ...clip, startTime: newStartTime, duration: newDuration, transitionOut }
  }
  return {
    ...clip,
    startTime: newStartTime,
    duration: newDuration,
    inPoint: clip.inPoint + frontCut * clip.speed,
    outPoint: clip.outPoint - backCut * clip.speed,
    transitionOut,
  }
}

/**
 * Folds adjacent same-track units linked by a transition into one combined
 * unit (recursively, so a chain of 3+ transitioned clips folds left to
 * right), via whatever filter `mergeFilter` builds. Units not linked to a
 * transition pass through unchanged.
 */
function mergeTransitions(
  items: Array<{ clip: Clip; unit: Unit }>,
  mergeFilter: (
    aLabel: string,
    bLabel: string,
    mergedLabel: string,
    transDur: number,
    transitionType: string,
    aDuration: number,
  ) => string,
  filterLines: string[],
  labelPrefix: string,
  counter: { n: number },
): Unit[] {
  const sorted = [...items].sort((a, b) => a.unit.startTime - b.unit.startTime)
  const result: Unit[] = []
  let i = 0
  while (i < sorted.length) {
    let currentClip = sorted[i].clip
    let currentUnit = sorted[i].unit
    while (
      i + 1 < sorted.length &&
      currentClip.transitionOut.type !== 'none' &&
      Math.abs(
        sorted[i + 1].unit.startTime - (currentUnit.startTime + currentUnit.duration - currentClip.transitionOut.duration),
      ) < 0.05
    ) {
      const next = sorted[i + 1]
      const transDur = Math.max(0.05, Math.min(currentClip.transitionOut.duration, currentUnit.duration, next.unit.duration))
      const mergedLabel = `${labelPrefix}${counter.n++}`
      filterLines.push(
        mergeFilter(currentUnit.label, next.unit.label, mergedLabel, transDur, currentClip.transitionOut.type, currentUnit.duration),
      )
      currentUnit = {
        label: mergedLabel,
        startTime: currentUnit.startTime,
        duration: currentUnit.duration + next.unit.duration - transDur,
      }
      currentClip = next.clip
      i++
    }
    result.push(currentUnit)
    i++
  }
  return result
}

/** Exported for reverseProxyManager.ts's preview proxy, which needs the exact same speed-adjustment chain. */
export function atempoChain(speed: number): string {
  // `atempo` only accepts 0.5–2.0; chain multiple stages for anything outside that.
  const stages: number[] = []
  let remaining = speed
  while (remaining > 2) {
    stages.push(2)
    remaining /= 2
  }
  while (remaining < 0.5) {
    stages.push(0.5)
    remaining /= 0.5
  }
  stages.push(remaining)
  return stages.map((s) => `atempo=${s.toFixed(6)}`).join(',')
}

export class VideoExportManager {
  constructor(
    private readonly projectManager: ProjectManager,
    private readonly editorManager: EditorManager,
  ) {}

  async exportMp4(
    projectId: string,
    outputName: string,
    onProgress: (progress: ExportProgress) => void,
    /** Absolute folder to write into — defaults to the project's own `exports/` folder when omitted (see ExportDialog.tsx's destination choice). */
    destinationDir?: string,
    /** Export just this window of the timeline instead of the whole thing — see `exportClip`. */
    range?: ExportRange,
  ): Promise<{ outputPath: string }> {
    onProgress({ stage: 'preparing', percent: 0 })
    const prepared = await this.prepareExport(projectId, range)

    const filterLines: string[] = []
    const labelCounter = { n: 0 }
    const voutLabel = this.buildVisualGraph(prepared, filterLines, labelCounter)
    const aoutLabel = this.buildAudioGraph(prepared, filterLines, labelCounter)
    const filterComplex = filterLines.join(';\n')

    const exportsDir = destinationDir || path.join(prepared.dir, 'exports')
    await fs.mkdir(exportsDir, { recursive: true })
    const outputPath = path.join(exportsDir, sanitizeOutputName(outputName, 'mp4'))

    const args = [
      '-y',
      ...prepared.inputArgs,
      '-filter_complex',
      filterComplex,
      '-map',
      `[${voutLabel}]`,
      '-map',
      `[${aoutLabel}]`,
      '-r',
      String(prepared.fps),
      '-t',
      prepared.totalDuration.toFixed(3),
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-preset',
      'medium',
      '-crf',
      '20',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-movflags',
      '+faststart',
      '-progress',
      'pipe:1',
      '-nostats',
      outputPath,
    ]

    await this.writeExportDiagnostics(prepared.dir, {
      projectId,
      outputPath,
      timeline: prepared.timeline,
      resolvedByClipId: prepared.resolvedByClipId,
      filterComplex,
      args,
    })

    onProgress({ stage: 'encoding', percent: 0 })
    await this.runFfmpeg(args, prepared.totalDuration, onProgress)
    onProgress({ stage: 'done', percent: 100 })

    return { outputPath }
  }

  /**
   * "Export Clip" (TODO.md's Phase 7 scope) — a real, standalone MP4 of just
   * the given window of the timeline, not the whole thing. Deliberately just
   * a thin wrapper around `exportMp4`'s existing `range` parameter rather
   * than a second implementation — same encode settings, same diagnostics,
   * same progress reporting.
   */
  async exportClip(
    projectId: string,
    outputName: string,
    range: ExportRange,
    onProgress: (progress: ExportProgress) => void,
    destinationDir?: string,
  ): Promise<{ outputPath: string }> {
    if (!(range.end > range.start)) throw new Error('Invalid clip range — the end must be after the start.')
    return this.exportMp4(projectId, outputName, onProgress, destinationDir, range)
  }

  /**
   * GIF export (TODO.md's Phase 7 scope) — the same range-clamped visual
   * composite `exportClip` would build, piped through a two-pass palette
   * (`palettegen`/`paletteuse`, the standard way to get a real-looking GIF
   * out of FFmpeg instead of the default 256-fixed-web-palette banding) at
   * the caller-chosen dimensions/fps/quality, with `-loop` controlling
   * whether it repeats.
   */
  async exportGif(
    projectId: string,
    outputName: string,
    options: GifExportOptions,
    onProgress: (progress: ExportProgress) => void,
    destinationDir?: string,
  ): Promise<{ outputPath: string }> {
    if (!(options.range.end > options.range.start)) throw new Error('Invalid GIF range — the end must be after the start.')
    onProgress({ stage: 'preparing', percent: 0 })
    const prepared = await this.prepareExport(projectId, options.range)

    const filterLines: string[] = []
    const labelCounter = { n: 0 }
    const voutLabel = this.buildVisualGraph(prepared, filterLines, labelCounter)

    const quality = GIF_QUALITY_PARAMS[options.quality]
    const width = Math.max(2, Math.round(options.width))
    const height = Math.max(2, Math.round(options.height))
    const fps = Math.max(1, Math.round(options.fps))
    filterLines.push(
      `[${voutLabel}]fps=${fps},scale=${width}:${height}:flags=lanczos,split[gs0][gs1]`,
      `[gs0]palettegen=max_colors=${quality.maxColors}:stats_mode=full[gpalette]`,
      `[gs1][gpalette]paletteuse=dither=${quality.dither}[gifout]`,
    )
    const filterComplex = filterLines.join(';\n')

    const exportsDir = destinationDir || path.join(prepared.dir, 'exports')
    await fs.mkdir(exportsDir, { recursive: true })
    const outputPath = path.join(exportsDir, sanitizeOutputName(outputName, 'gif'))

    const args = [
      '-y',
      ...prepared.inputArgs,
      '-filter_complex',
      filterComplex,
      '-map',
      '[gifout]',
      '-loop',
      options.loop ? '0' : '-1',
      '-progress',
      'pipe:1',
      '-nostats',
      outputPath,
    ]

    onProgress({ stage: 'encoding', percent: 0 })
    await this.runFfmpeg(args, prepared.totalDuration, onProgress)
    onProgress({ stage: 'done', percent: 100 })

    return { outputPath }
  }

  /**
   * Still-frame export (TODO.md's Phase 7 scope) — captures exactly one
   * composited frame at a timeline position as a real PNG/JPEG. Reuses
   * `prepareExport`'s range-clamping with a razor-thin window
   * (`time`..`time`+1 output frame) rather than rendering the whole timeline
   * and seeking within it: every clip's own trim math already shifts to
   * "start of the window" the same way `exportClip` relies on, so this stays
   * cheap regardless of how far into a long timeline `time` is, and `-frames:v
   * 1` guarantees exactly one frame comes out even though the window itself
   * isn't exactly one frame long.
   */
  async exportStillFrame(
    projectId: string,
    outputName: string,
    options: StillFrameOptions,
    destinationDir?: string,
  ): Promise<{ outputPath: string }> {
    const start = Math.max(0, options.time)
    const prepared = await this.prepareExport(projectId, { start, end: start + 1 / 30 })

    const filterLines: string[] = []
    const labelCounter = { n: 0 }
    const voutLabel = this.buildVisualGraph(prepared, filterLines, labelCounter)
    const filterComplex = filterLines.join(';\n')

    const exportsDir = destinationDir || path.join(prepared.dir, 'exports')
    await fs.mkdir(exportsDir, { recursive: true })
    const ext = options.format === 'jpg' ? 'jpg' : 'png'
    const outputPath = path.join(exportsDir, sanitizeOutputName(outputName, ext))

    const args = ['-y', ...prepared.inputArgs, '-filter_complex', filterComplex, '-map', `[${voutLabel}]`, '-frames:v', '1', outputPath]

    await this.runFfmpeg(args, prepared.totalDuration, () => {})

    return { outputPath }
  }

  /**
   * Loads the timeline and (when `range` is given) clamps every clip to that
   * window and shifts it onto the window's own clock via
   * `clampClipToRange`, then resolves every media clip's asset to an actual
   * FFmpeg input — exactly the input-resolution half of what used to be the
   * front of `exportMp4` before Phase 7 split it out so `exportGif`/
   * `exportStillFrame` (and `exportClip`, via `exportMp4`'s own `range`) can
   * all share it instead of re-deriving it.
   */
  private async prepareExport(projectId: string, range?: ExportRange): Promise<PreparedExport> {
    const dir = await requireProjectDir(projectId)
    const rawTimeline = await this.editorManager.getTimeline(projectId)

    let clips: Clip[]
    let totalDuration: number
    if (range) {
      clips = rawTimeline.clips.map((c) => clampClipToRange(c, range)).filter((c): c is Clip => c !== null)
      totalDuration = range.end - range.start
    } else {
      clips = rawTimeline.clips
      totalDuration = clips.length > 0 ? Math.max(...clips.map((c) => c.startTime + c.duration)) : 0
    }
    if (clips.length === 0) {
      throw new Error(range ? 'No clips exist in the selected range.' : 'The timeline is empty — add at least one clip first.')
    }
    if (!Number.isFinite(totalDuration) || totalDuration <= 0) {
      throw new Error('Could not determine the export duration.')
    }

    const timeline: Timeline = { ...rawTimeline, clips }
    const { width, height, fps, backgroundColor } = timeline.projectSettings

    const assets = await this.projectManager.listAssets(projectId)
    const assetById = new Map(assets.map((a) => [a.id, a]))

    const inputArgs: string[] = []
    const resolvedByClipId = new Map<string, ResolvedInput>()
    let nextInputIndex = 0

    for (const clip of clips) {
      if (clip.kind !== 'media' || !clip.assetId) continue
      const asset = assetById.get(clip.assetId)
      if (!asset) throw new Error(`Asset for a clip on the timeline no longer exists.`)
      const absPath = await this.projectManager.getAssetAbsolutePath(projectId, asset.id)
      const info = await probeMedia(absPath).catch(() => null)
      const hasAudio = info?.hasAudio ?? asset.kind === 'audio'

      if (asset.kind === 'image') {
        inputArgs.push('-loop', '1', '-framerate', String(fps), '-i', absPath)
      } else {
        inputArgs.push('-i', absPath)
      }
      resolvedByClipId.set(clip.id, { clip, asset, absPath, inputIndex: nextInputIndex, hasAudio })
      nextInputIndex++
    }

    return { dir, timeline, totalDuration, width, height, fps, backgroundColor, inputArgs, resolvedByClipId }
  }

  /**
   * Builds the background + per-clip visual chains + transition-merge +
   * time-shifted overlay composite, pushing every line into `filterLines`
   * and returning the label of the final composited video stream (always
   * `'vout'`, plain `yuv420p`, no audio) — shared by every export type in
   * this file, since all four need "what does the picture look like."
   */
  private buildVisualGraph(prepared: PreparedExport, filterLines: string[], labelCounter: { n: number }): string {
    const { timeline, resolvedByClipId, totalDuration, width, height, fps, backgroundColor } = prepared

    filterLines.push(
      `color=c=${hex(backgroundColor)}:s=${width}x${height}:r=${fps}:d=${totalDuration.toFixed(3)},format=yuva420p[base0]`,
    )

    const videoTracks = timeline.tracks.filter((t) => t.type === 'video' && !t.hidden)
    const overlayTracks = timeline.tracks.filter((t) => t.type === 'overlay' && !t.hidden)
    const visualTracks = [...sortByOrder(videoTracks), ...sortByOrder(overlayTracks)]

    const visualUnitsByTrack = new Map<string, Array<{ clip: Clip; unit: Unit }>>()

    for (const track of visualTracks) {
      const clipsOnTrack = timeline.clips.filter((c) => c.trackId === track.id)
      const items: Array<{ clip: Clip; unit: Unit }> = []
      for (const clip of clipsOnTrack) {
        const label = `v${labelCounter.n++}`
        if (clip.kind === 'text' && clip.text) {
          filterLines.push(this.buildTextChain(clip, label, width, height, fps))
        } else {
          const resolved = resolvedByClipId.get(clip.id)
          if (!resolved) continue
          filterLines.push(this.buildVisualChain(clip, resolved, label, width, height))
        }
        items.push({ clip, unit: { label, startTime: clip.startTime, duration: clip.duration } })
      }
      visualUnitsByTrack.set(track.id, items)
    }

    let running = 'base0'
    for (const track of visualTracks) {
      const items = visualUnitsByTrack.get(track.id) ?? []
      if (items.length === 0) continue
      const merged = mergeTransitions(
        items,
        (a, b, out, d, type, aDuration) =>
          `[${a}][${b}]xfade=transition=${type}:duration=${d.toFixed(3)}:offset=${(aDuration - d).toFixed(3)}[${out}]`,
        filterLines,
        'xf',
        labelCounter,
      )
      for (const unit of merged) {
        const shifted = `sh${labelCounter.n++}`
        filterLines.push(`[${unit.label}]setpts=PTS+${unit.startTime.toFixed(3)}/TB[${shifted}]`)
        const nextRunning = `ov${labelCounter.n++}`
        const start = unit.startTime.toFixed(3)
        const end = (unit.startTime + unit.duration).toFixed(3)
        // `format=auto` (rather than the `overlay` filter's default `format=
        // yuv420`, which is not alpha-carrying) plus re-asserting
        // `format=yuva420p` afterward keeps the running composite alpha-safe
        // end-to-end, so a chroma-keyed/faded clip's transparency is never
        // implicitly at the mercy of the `overlay` filter's own default
        // output format on whatever FFmpeg build happens to be resolved by
        // `ffmpeg-static` — see this file's header comment and TODO.md's
        // chroma-key-on-export item for why this needs to be explicit rather
        // than relying on a filter default.
        filterLines.push(
          `[${running}][${shifted}]overlay=x=0:y=0:format=auto:enable='between(t,${start},${end})',format=yuva420p[${nextRunning}]`,
        )
        running = nextRunning
      }
    }
    filterLines.push(`[${running}]format=yuv420p[vout]`)
    return 'vout'
  }

  /**
   * Builds the silent bed + per-clip audio chains + transition-merge +
   * delayed mix, pushing every line into `filterLines` and returning the
   * label of the final mixed audio stream (always `'aout'`) — shared by
   * `exportMp4`/`exportClip` (GIF and still-frame exports have no audio, so
   * they never call this).
   */
  private buildAudioGraph(prepared: PreparedExport, filterLines: string[], labelCounter: { n: number }): string {
    const { timeline, resolvedByClipId, totalDuration } = prepared

    filterLines.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${totalDuration.toFixed(3)}[silence]`)

    const audioTracks = sortByOrder(timeline.tracks.filter((t) => t.type === 'audio'))
    const audioMixLabels: string[] = ['silence']

    for (const track of audioTracks) {
      const clipsOnTrack = timeline.clips.filter((c) => c.trackId === track.id)
      const items: Array<{ clip: Clip; unit: Unit }> = []
      for (const clip of clipsOnTrack) {
        const resolved = resolvedByClipId.get(clip.id)
        if (!resolved || !resolved.hasAudio || track.muted) continue
        const label = `a${labelCounter.n++}`
        filterLines.push(this.buildAudioChain(clip, resolved, label))
        items.push({ clip, unit: { label, startTime: clip.startTime, duration: clip.duration } })
      }
      const merged = mergeTransitions(
        items,
        (a, b, out, d) => `[${a}][${b}]acrossfade=d=${d.toFixed(3)}[${out}]`,
        filterLines,
        'axf',
        labelCounter,
      )
      for (const unit of merged) {
        const delayed = `ad${labelCounter.n++}`
        const ms = Math.round(unit.startTime * 1000)
        filterLines.push(`[${unit.label}]adelay=${ms}:all=1[${delayed}]`)
        audioMixLabels.push(delayed)
      }
    }

    // Video-track clips with their own included audio, independent of the
    // video-track transition-merge above (audio doesn't visually transition).
    for (const track of timeline.tracks.filter((t) => t.type === 'video' && !t.hidden)) {
      if (track.muted) continue
      for (const clip of timeline.clips.filter((c) => c.trackId === track.id)) {
        const resolved = resolvedByClipId.get(clip.id)
        if (!resolved || !resolved.hasAudio || !clip.includeAudio) continue
        const label = `a${labelCounter.n++}`
        filterLines.push(this.buildAudioChain(clip, resolved, label))
        const delayed = `ad${labelCounter.n++}`
        filterLines.push(`[${label}]adelay=${Math.round(clip.startTime * 1000)}:all=1[${delayed}]`)
        audioMixLabels.push(delayed)
      }
    }

    filterLines.push(
      `${audioMixLabels.map((l) => `[${l}]`).join('')}amix=inputs=${audioMixLabels.length}:duration=longest:normalize=0,alimiter=limit=0.95[aout]`,
    )
    return 'aout'
  }

  /**
   * TEMPORARY diagnostic logging for the chroma-key-on-export bug (TODO.md —
   * still not reproducible against last round's synthetic test footage).
   * Written unconditionally on every MP4/clip export attempt, success or
   * failure, since the reported symptom is a *wrong-looking* export, not an
   * FFmpeg error — a try/catch around just the failure path would miss
   * exactly the run that matters. Remove once that bug is actually closed
   * out; this isn't meant to be permanent instrumentation. Not written for
   * GIF/still-frame exports — a different, format-specific tail, and this
   * diagnostic is specifically about the chroma-key/alpha-compositing chain
   * `buildVisualGraph` shares with them anyway.
   *
   * Written to a fixed filename in the project's own `exports/` folder
   * (never the custom per-export destination from item 6 — this file needs
   * to be somewhere predictable regardless of where the output itself
   * lands), overwriting the previous attempt's log each time, plus mirrored
   * to the console for whenever the app happens to be run from a visible
   * terminal (`npm run dev`/`npm start`) rather than the hidden-console
   * launcher.
   */
  private async writeExportDiagnostics(
    projectDir: string,
    info: {
      projectId: string
      outputPath: string
      timeline: Timeline
      resolvedByClipId: Map<string, ResolvedInput>
      filterComplex: string
      args: string[]
    },
  ): Promise<void> {
    const lines: string[] = []
    const push = (s: string) => lines.push(s)

    push(`=== Export diagnostics — ${new Date().toISOString()} ===`)
    push(`Project: ${info.projectId}`)
    push(`Output: ${info.outputPath}`)
    const { width, height, fps, backgroundColor } = info.timeline.projectSettings
    push(`Canvas: ${width}x${height} @ ${fps}fps, background ${backgroundColor}`)
    push('')

    push('--- Source clips involved (per-clip settings + FFprobe of the underlying file) ---')
    for (const clip of info.timeline.clips) {
      const track = info.timeline.tracks.find((t) => t.id === clip.trackId)
      const resolved = info.resolvedByClipId.get(clip.id)
      push(
        `Clip ${clip.id} on track "${track?.name ?? clip.trackId}" (${track?.type ?? '?'}), ` +
          `startTime=${clip.startTime.toFixed(3)} duration=${clip.duration.toFixed(3)} ` +
          `transitionOut=${clip.transitionOut.type}${clip.transitionOut.type !== 'none' ? `(${clip.transitionOut.duration}s)` : ''}`,
      )
      if (clip.kind === 'media') {
        push(
          `  chromaKey: enabled=${clip.chromaKey.enabled}` +
            (clip.chromaKey.enabled
              ? ` color=${clip.chromaKey.color} similarity=${clip.chromaKey.similarity} blend=${clip.chromaKey.blend}`
              : ''),
        )
        push(`  crop=${clip.crop ? JSON.stringify(clip.crop) : 'none'} transform=${JSON.stringify(clip.transform)}`)
        push(`  speed=${clip.speed} reverse=${clip.reverse} mirror=${clip.mirror} inPoint=${clip.inPoint} outPoint=${clip.outPoint}`)
        if (resolved) {
          push(`  file: ${resolved.absPath}`)
          try {
            const diag = await probeMediaDiagnostics(resolved.absPath)
            push(
              `  ffprobe: ${diag.width}x${diag.height} videoCodec=${diag.videoCodec} pixFmt=${diag.pixFmt} ` +
                `audioCodec=${diag.audioCodec} durationSec=${diag.durationSec.toFixed(3)}`,
            )
          } catch (err) {
            push(`  ffprobe: FAILED — ${(err as Error).message}`)
          }
        } else {
          push(`  file: (no resolved input — asset missing or clip has no assetId)`)
        }
      } else {
        push(`  text clip: "${clip.text?.content ?? ''}"`)
      }
    }

    push('')
    push('--- Generated filter_complex ---')
    push(info.filterComplex)
    push('')
    push('--- Full FFmpeg args ---')
    push(JSON.stringify(info.args, null, 2))
    push('')

    const text = lines.join('\n')
    console.log(text)
    try {
      await fs.mkdir(path.join(projectDir, 'exports'), { recursive: true })
      await fs.writeFile(path.join(projectDir, 'exports', 'export-diagnostics.log'), text, 'utf-8')
    } catch (err) {
      console.error('[videoExportManager] could not write export-diagnostics.log:', err)
    }
  }

  private buildVisualChain(clip: Clip, resolved: ResolvedInput, label: string, canvasW: number, canvasH: number): string {
    const parts: string[] = []
    const isImage = resolved.asset.kind === 'image'

    if (isImage) {
      parts.push(`trim=duration=${clip.duration.toFixed(3)}`, `setpts=PTS-STARTPTS`)
    } else {
      parts.push(
        `trim=start=${clip.inPoint.toFixed(3)}:end=${clip.outPoint.toFixed(3)}`,
        `setpts=(PTS-STARTPTS)/${clip.speed.toFixed(4)}`,
      )
    }

    // `reverse` needs the whole (already-trimmed) clip buffered in memory,
    // which is exactly why it comes right after the trim above rather than
    // on the full source — see this file's header comment on trim-first
    // ordering. It regenerates PTS itself, so nothing downstream needs to
    // account for having played the clip backwards.
    if (clip.reverse) parts.push('reverse')

    if (clip.crop) {
      const c = clip.crop
      parts.push(`crop=${Math.round(c.width)}:${Math.round(c.height)}:${Math.round(c.x)}:${Math.round(c.y)}`)
    }

    const t = clip.transform
    parts.push(`scale=${Math.round(t.width)}:${Math.round(t.height)}`)

    if (clip.mirror) parts.push('hflip')

    if (clip.chromaKey.enabled) {
      parts.push(`chromakey=color=${hex(clip.chromaKey.color)}:similarity=${clip.chromaKey.similarity}:blend=${clip.chromaKey.blend}`)
    }

    parts.push(
      `format=rgba`,
      `pad=${canvasW}:${canvasH}:${Math.round(t.x)}:${Math.round(t.y)}:color=0x00000000`,
      `format=yuva420p`,
    )

    if (clip.fadeInDuration > 0) parts.push(`fade=t=in:st=0:d=${clip.fadeInDuration.toFixed(3)}:alpha=1`)
    if (clip.fadeOutDuration > 0) {
      const st = Math.max(0, clip.duration - clip.fadeOutDuration)
      parts.push(`fade=t=out:st=${st.toFixed(3)}:d=${clip.fadeOutDuration.toFixed(3)}:alpha=1`)
    }

    return `[${resolved.inputIndex}:v]${parts.join(',')}[${label}]`
  }

  private buildTextChain(clip: Clip, label: string, canvasW: number, canvasH: number, fps: number): string {
    const text = clip.text!
    const t = clip.transform
    let xExpr: string
    if (text.align === 'left') xExpr = `${Math.round(t.x + 10)}`
    else if (text.align === 'right') xExpr = `${Math.round(t.x + t.width)}-text_w-10`
    else xExpr = `${Math.round(t.x)}+(${Math.round(t.width)}-text_w)/2`
    const yExpr = `${Math.round(t.y)}+(${Math.round(t.height)}-text_h)/2`

    const boxPart = text.backgroundColor ? `:box=1:boxcolor=${hex(text.backgroundColor)}@0.6:boxborderw=12` : ''

    const parts = [
      `color=c=black@0.0:s=${canvasW}x${canvasH}:r=${fps}:d=${clip.duration.toFixed(3)}`,
      `format=yuva420p`,
      `drawtext=text='${escapeDrawtext(text.content)}':expansion=none:font='${text.fontFamily.replace(/'/g, '')}':fontsize=${Math.round(
        text.fontSize,
      )}:fontcolor=${hex(text.color)}:x=${xExpr}:y=${yExpr}${boxPart}`,
    ]
    if (clip.fadeInDuration > 0) parts.push(`fade=t=in:st=0:d=${clip.fadeInDuration.toFixed(3)}:alpha=1`)
    if (clip.fadeOutDuration > 0) {
      const st = Math.max(0, clip.duration - clip.fadeOutDuration)
      parts.push(`fade=t=out:st=${st.toFixed(3)}:d=${clip.fadeOutDuration.toFixed(3)}:alpha=1`)
    }
    return `${parts.join(',')}[${label}]`
  }

  private buildAudioChain(clip: Clip, resolved: ResolvedInput, label: string): string {
    const parts: string[] = []
    parts.push(`atrim=start=${clip.inPoint.toFixed(3)}:end=${clip.outPoint.toFixed(3)}`, `asetpts=PTS-STARTPTS`)
    if (clip.reverse) parts.push('areverse')
    if (Math.abs(clip.speed - 1) > 0.001) parts.push(atempoChain(clip.speed))
    parts.push(`volume=${clip.volume.toFixed(3)}`)
    if (clip.fadeInDuration > 0) parts.push(`afade=t=in:st=0:d=${clip.fadeInDuration.toFixed(3)}`)
    if (clip.fadeOutDuration > 0) {
      const st = Math.max(0, clip.duration - clip.fadeOutDuration)
      parts.push(`afade=t=out:st=${st.toFixed(3)}:d=${clip.fadeOutDuration.toFixed(3)}`)
    }
    return `[${resolved.inputIndex}:a]${parts.join(',')}[${label}]`
  }

  private runFfmpeg(args: string[], totalDuration: number, onProgress: (p: ExportProgress) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn(ffmpegBinaryPath(), args)
      let stderrTail = ''

      proc.stdout.setEncoding('utf-8')
      proc.stdout.on('data', (chunk: string) => {
        const outTimeMatch = chunk.match(/out_time_ms=(\d+)/)
        if (outTimeMatch) {
          const seconds = Number(outTimeMatch[1]) / 1_000_000
          const percent = Math.min(99, Math.max(0, (seconds / totalDuration) * 100))
          onProgress({ stage: 'encoding', percent })
        }
      })
      proc.stderr.setEncoding('utf-8')
      proc.stderr.on('data', (chunk: string) => {
        stderrTail = (stderrTail + chunk).slice(-4000)
      })
      proc.on('error', (err) => reject(err))
      proc.on('close', (code) => {
        if (code === 0) resolve()
        else reject(new Error(`FFmpeg exited with code ${code}.\n${stderrTail}`))
      })
    })
  }
}
