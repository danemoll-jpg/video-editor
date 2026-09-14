// FFprobe metadata lookups — used by editorManager.ts when a clip is added
// to the timeline (to know a video/audio asset's real duration, and a
// video's dimensions/frame rate, without Dan having to type any of that in).
// See videoRuntime.ts for where the ffprobe binary itself comes from.

import { execFile } from 'node:child_process'
import { ffprobeBinaryPath } from './videoRuntime'

export interface MediaInfo {
  durationSec: number
  width: number | null
  height: number | null
  fps: number | null
  hasVideo: boolean
  hasAudio: boolean
}

interface FfprobeStream {
  codec_type: string
  codec_name?: string
  pix_fmt?: string
  width?: number
  height?: number
  r_frame_rate?: string
  avg_frame_rate?: string
  duration?: string
}

interface FfprobeFormat {
  duration?: string
}

interface FfprobeOutput {
  streams: FfprobeStream[]
  format: FfprobeFormat
}

export interface MediaDiagnostics {
  durationSec: number
  width: number | null
  height: number | null
  videoCodec: string | null
  pixFmt: string | null
  audioCodec: string | null
}

function parseFrameRate(raw: string | undefined): number | null {
  if (!raw) return null
  const [num, den] = raw.split('/').map(Number)
  if (!num || !den) return null
  const fps = num / den
  return Number.isFinite(fps) && fps > 0 ? fps : null
}

/** Probes a media file's duration/dimensions/frame rate/stream presence via FFprobe. */
export function probeMedia(filePath: string): Promise<MediaInfo> {
  return new Promise((resolve, reject) => {
    execFile(
      ffprobeBinaryPath(),
      ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath],
      { maxBuffer: 10 * 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          reject(new Error(`Could not read media info: ${err.message}`))
          return
        }
        try {
          const data = JSON.parse(stdout) as FfprobeOutput
          const videoStream = data.streams?.find((s) => s.codec_type === 'video')
          const audioStream = data.streams?.find((s) => s.codec_type === 'audio')
          const formatDuration = Number(data.format?.duration)
          const streamDuration = Number(videoStream?.duration ?? audioStream?.duration)
          const durationSec = Number.isFinite(formatDuration)
            ? formatDuration
            : Number.isFinite(streamDuration)
              ? streamDuration
              : 0

          resolve({
            durationSec,
            width: videoStream?.width ?? null,
            height: videoStream?.height ?? null,
            fps: parseFrameRate(videoStream?.avg_frame_rate ?? videoStream?.r_frame_rate),
            hasVideo: !!videoStream,
            hasAudio: !!audioStream,
          })
        } catch (parseErr) {
          reject(new Error(`Could not parse media info: ${(parseErr as Error).message}`))
        }
      },
    )
  })
}

/**
 * Like `probeMedia`, but additionally reports codec names and pixel format —
 * added (2026-09-13) purely for the chroma-key-on-export diagnostic logging
 * in videoExportManager.ts (see that file's header comment and TODO.md's
 * chroma-key item). Not folded into `MediaInfo`/`probeMedia` itself since
 * nothing else needs these fields, and keeping this separate means the
 * existing, already-relied-upon `probeMedia` contract can't be disturbed by
 * a diagnostics-only addition.
 */
export function probeMediaDiagnostics(filePath: string): Promise<MediaDiagnostics> {
  return new Promise((resolve, reject) => {
    execFile(
      ffprobeBinaryPath(),
      ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath],
      { maxBuffer: 10 * 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          reject(new Error(`Could not read media info: ${err.message}`))
          return
        }
        try {
          const data = JSON.parse(stdout) as FfprobeOutput
          const videoStream = data.streams?.find((s) => s.codec_type === 'video')
          const audioStream = data.streams?.find((s) => s.codec_type === 'audio')
          const formatDuration = Number(data.format?.duration)
          const streamDuration = Number(videoStream?.duration ?? audioStream?.duration)
          const durationSec = Number.isFinite(formatDuration)
            ? formatDuration
            : Number.isFinite(streamDuration)
              ? streamDuration
              : 0

          resolve({
            durationSec,
            width: videoStream?.width ?? null,
            height: videoStream?.height ?? null,
            videoCodec: videoStream?.codec_name ?? null,
            pixFmt: videoStream?.pix_fmt ?? null,
            audioCodec: audioStream?.codec_name ?? null,
          })
        } catch (parseErr) {
          reject(new Error(`Could not parse media info: ${(parseErr as Error).message}`))
        }
      },
    )
  })
}
