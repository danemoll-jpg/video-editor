// Resolves the FFmpeg/FFprobe binaries this whole Phase 6 editor shells out
// to. Both come from vendor npm packages (ffmpeg-static/ffprobe-static —
// each just resolves to a downloaded platform binary, see vendor.d.ts for
// their ambient types) rather than requiring Dan to have FFmpeg on his PATH.
// Every other Phase 6 file that needs to run FFmpeg/FFprobe (mediaProbe.ts,
// videoExportManager.ts) imports its path from here instead of importing the
// vendor packages directly, so there's one place that would need updating if
// this app is ever packaged (electron-builder needs these binaries marked
// `asarUnpack` — not needed yet, since the app isn't packaged, per CLAUDE.md/
// TODO.md's "personal dev-run app" scope).

import ffmpegPath from 'ffmpeg-static'
import ffprobeStatic from 'ffprobe-static'

export function ffmpegBinaryPath(): string {
  if (!ffmpegPath) throw new Error('FFmpeg binary not found (ffmpeg-static failed to resolve).')
  return ffmpegPath
}

export function ffprobeBinaryPath(): string {
  return ffprobeStatic.path
}
