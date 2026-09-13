// Extracts a media file's audio track into a new standalone audio file via
// FFmpeg's `-vn` (video-none) — used by projectManager.ts's "Extract Audio"
// asset action (Assets tab / Media Library, per TODO.md) to turn an
// imported video's audio into a real new audio asset. Always re-encodes to
// AAC rather than stream-copying the source codec, so the output plays
// correctly regardless of what audio codec/container the source video used.
// Small, single-purpose file — same pattern as mediaProbe.ts/videoRuntime.ts
// — rather than folding another FFmpeg call site into videoExportManager.ts,
// which is specifically "turning a *timeline* into a real MP4" per
// CLAUDE.md, not general asset transformations.

import { spawn } from 'node:child_process'
import { ffmpegBinaryPath } from './videoRuntime'

export function extractAudioTrack(inputPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegBinaryPath(), ['-y', '-i', inputPath, '-vn', '-c:a', 'aac', '-b:a', '192k', outputPath])
    let stderrTail = ''
    proc.stderr.setEncoding('utf-8')
    proc.stderr.on('data', (chunk: string) => {
      stderrTail = (stderrTail + chunk).slice(-4000)
    })
    proc.on('error', (err) => reject(err))
    proc.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`FFmpeg exited with code ${code} while extracting audio.\n${stderrTail}`))
    })
  })
}
