// Builds an FFmpeg command from a project's timeline (editorManager.ts) and
// runs it, producing a real MP4 in the project's `exports/` folder — the
// only place in the app that ever synthesizes video, so all the "how do
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

import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { ProjectManager, Asset } from './projectManager'
import type { EditorManager } from './editorManager'
import { probeMedia } from './mediaProbe'
import { ffmpegBinaryPath } from './videoRuntime'
import { requireProjectDir } from './projectPaths'
import type { Clip, Timeline, Track } from './editorTypes'

export interface ExportProgress {
  stage: 'preparing' | 'encoding' | 'done' | 'error'
  percent: number
  message?: string
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

function hex(color: string): string {
  return `0x${color.replace('#', '')}`
}

function escapeDrawtext(text: string): string {
  // Sidesteps FFmpeg's notoriously two-layered filtergraph/drawtext quoting
  // by removing the one character (a literal `'`) that would otherwise need
  // it, rather than trying to escape it — see this file's header comment.
  return text.replace(/'/g, '’').replace(/\r\n|\r|\n/g, ' ')
}

function atempoChain(speed: number): string {
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
  ): Promise<{ outputPath: string }> {
    const dir = await requireProjectDir(projectId)
    const timeline = await this.editorManager.getTimeline(projectId)

    onProgress({ stage: 'preparing', percent: 0 })

    if (timeline.clips.length === 0) throw new Error('The timeline is empty — add at least one clip first.')

    const { width, height, fps, backgroundColor } = timeline.projectSettings
    const totalDuration = Math.max(...timeline.clips.map((c) => c.startTime + c.duration))
    if (!Number.isFinite(totalDuration) || totalDuration <= 0) {
      throw new Error('Could not determine the timeline duration.')
    }

    const assets = await this.projectManager.listAssets(projectId)
    const assetById = new Map(assets.map((a) => [a.id, a]))

    const inputArgs: string[] = []
    const resolvedByClipId = new Map<string, ResolvedInput>()
    let nextInputIndex = 0

    for (const clip of timeline.clips) {
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

    const filterLines: string[] = []
    const labelCounter = { n: 0 }

    // --- Background base -----------------------------------------------
    filterLines.push(
      `color=c=${hex(backgroundColor)}:s=${width}x${height}:r=${fps}:d=${totalDuration.toFixed(3)},format=yuva420p[base0]`,
    )
    filterLines.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${totalDuration.toFixed(3)}[silence]`)

    // --- Per-clip visual streams (video/overlay tracks + text clips) -------

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

    // --- Audio ------------------------------------------------------------

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
    for (const track of videoTracks) {
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

    const filterComplex = filterLines.join(';\n')

    const exportsDir = destinationDir || path.join(dir, 'exports')
    await fs.mkdir(exportsDir, { recursive: true })
    const safeName = outputName.trim().replace(/[\\/:*?"<>|]/g, '_') || `export-${randomUUID().slice(0, 8)}`
    const outputPath = path.join(exportsDir, safeName.endsWith('.mp4') ? safeName : `${safeName}.mp4`)

    const args = [
      '-y',
      ...inputArgs,
      '-filter_complex',
      filterComplex,
      '-map',
      '[vout]',
      '-map',
      '[aout]',
      '-r',
      String(fps),
      '-t',
      totalDuration.toFixed(3),
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

    onProgress({ stage: 'encoding', percent: 0 })
    await this.runFfmpeg(args, totalDuration, onProgress)
    onProgress({ stage: 'done', percent: 100 })

    return { outputPath }
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

function sortByOrder(tracks: Track[]): Track[] {
  return [...tracks].sort((a, b) => a.order - b.order)
}
