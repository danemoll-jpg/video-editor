// Renders a small cached "reversed" proxy file for one timeline clip's
// currently-trimmed range, so the live preview (PreviewPlayer.tsx) can show
// a *real* reversed preview when a clip's `reverse` is on — browsers can't
// play an HTML5 <video>/<audio> backwards (no negative playbackRate), which
// is why every earlier round of this feature (see TODO.md) could only ever
// preview forward while exporting correctly reversed. Instead of that
// documented simplification, this pre-renders the reversal once via FFmpeg
// and the preview just plays the result forward.
//
// Only the clip's current trim range is rendered here (via input-side
// `-ss`/`-to`, so FFmpeg never even decodes the rest of the source) — not
// the whole source file — same "buffer just the trimmed part" reasoning as
// the export path's own `reverse` filter placement right after trim (see
// videoExportManager.ts's buildVisualChain/buildAudioChain comments). The
// output is also scale-capped (`PREVIEW_MAX_WIDTH`) and encoded with a fast
// preset, since this is a cheap preview proxy, not the authoritative
// renderer — the export always re-derives the real reversed frames itself
// via its own `reverse`/`areverse` filters, at full quality, regardless of
// whether a preview proxy exists or matches.
//
// editorManager.ts owns *when* to (re)generate/delete one of these (on
// `reverse` being turned on, whenever the trim/speed it was rendered for
// goes stale, and cleanup on reverse-off/clip-delete/project-delete); this
// file only knows how to render one, given a resolved source file and the
// trim/speed to apply — same small-single-purpose-file pattern as
// audioExtractor.ts/mediaProbe.ts.

import { spawn } from 'node:child_process'
import { ffmpegBinaryPath } from './videoRuntime'
import { atempoChain } from './videoExportManager'

export interface ReverseProxySource {
  absPath: string
  /** Source-time trim range (pre-speed), same units as Clip.inPoint/outPoint. */
  inPoint: number
  outPoint: number
  speed: number
  hasVideo: boolean
  hasAudio: boolean
}

const PREVIEW_MAX_WIDTH = 960

/** Renders `source`'s trimmed range, reversed, into `outputPath` (an .mp4). */
export function renderReverseProxy(source: ReverseProxySource, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const { absPath, inPoint, outPoint, speed, hasVideo, hasAudio } = source
    if (!hasVideo && !hasAudio) {
      reject(new Error('Source has neither a video nor an audio stream to reverse.'))
      return
    }

    // Input-side -ss/-to (before -i) trims at the source's own timeline —
    // simpler and cheaper than the export's filter-based `trim`/`atrim`,
    // which is fine here since a preview proxy only ever needs exactly this
    // one trimmed range, never the whole file.
    const args = ['-y', '-ss', inPoint.toFixed(3), '-to', outPoint.toFixed(3), '-i', absPath]

    if (hasVideo) {
      const speedPart = Math.abs(speed - 1) > 0.001 ? `setpts=(PTS-STARTPTS)/${speed.toFixed(4)}` : 'setpts=PTS-STARTPTS'
      args.push(
        '-vf',
        `${speedPart},reverse,scale='min(${PREVIEW_MAX_WIDTH},iw)':-2`,
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '23',
        '-pix_fmt',
        'yuv420p',
      )
    } else {
      args.push('-vn')
    }

    if (hasAudio) {
      const atempo = Math.abs(speed - 1) > 0.001 ? `,${atempoChain(speed)}` : ''
      args.push('-af', `asetpts=PTS-STARTPTS,areverse${atempo}`, '-c:a', 'aac', '-b:a', '160k')
    } else {
      args.push('-an')
    }

    args.push('-movflags', '+faststart', outputPath)

    const proc = spawn(ffmpegBinaryPath(), args)
    let stderrTail = ''
    proc.stderr.setEncoding('utf-8')
    proc.stderr.on('data', (chunk: string) => {
      stderrTail = (stderrTail + chunk).slice(-4000)
    })
    proc.on('error', (err) => reject(err))
    proc.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`FFmpeg exited with code ${code} while rendering a reversed preview proxy.\n${stderrTail}`))
    })
  })
}
