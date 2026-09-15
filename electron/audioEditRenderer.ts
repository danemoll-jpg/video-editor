// The Audio Editor's one FFmpeg call site (mirrors audioExtractor.ts/
// reverseProxyManager.ts — a small single-purpose file, not folded into
// videoExportManager.ts, which is specifically about turning a *timeline*
// into a picture, not general standalone-asset transforms). Builds one `-af`
// filter chain from an AudioEditSpec and runs it through the bundled FFmpeg
// binary — this is the "committed" side of the split described in TODO.md's
// Audio Editor scope: src/audioEditPreview.ts's Web Audio graph is the live,
// interactive approximation; this is the authoritative renderer, same
// relationship videoExportManager.ts has with PreviewPlayer.tsx's canvas
// compositor.
//
// Peak normalize needs an actual measurement of the trimmed range's loudest
// sample — FFmpeg has no single filter that normalizes to peak by itself —
// so that mode runs a quick first pass with `volumedetect` (parsing
// `max_volume` out of its stderr) before the real render, exactly the
// two-pass idiom `loudnorm` avoids needing (a single `loudnorm=...` call is
// self-analyzing).

import { execFile, spawn } from 'node:child_process'
import { ffmpegBinaryPath } from './videoRuntime'
import type { AudioEditSpec, EnvelopePoint } from './audioEditTypes'

/**
 * Builds a piecewise-linear FFmpeg `eval` expression in `t` (seconds since
 * the trimmed clip's own start) from a sorted envelope — nested `if(lt(t,
 * ...), ramp, rest)` terms, holding the first/last point's gain outside the
 * envelope's own time span. Matches the linear ramps
 * `src/audioEditPreview.ts`'s Web Audio preview schedules via
 * `linearRampToValueAtTime`, so the live preview and the committed render
 * agree exactly on envelope shape (unlike the fade curves, which are a
 * best-effort JS approximation of FFmpeg's afade curve shapes).
 */
function buildEnvelopeExpression(points: EnvelopePoint[]): string {
  const sorted = [...points].sort((a, b) => a.time - b.time)

  function segmentExpr(i: number): string {
    if (i === sorted.length - 1) return sorted[i].gain.toFixed(4)
    const p0 = sorted[i]
    const p1 = sorted[i + 1]
    const span = p1.time - p0.time
    if (span <= 0.0001) return segmentExpr(i + 1)
    const ramp = `${p0.gain.toFixed(4)}+(${(p1.gain - p0.gain).toFixed(4)})*(t-${p0.time.toFixed(4)})/${span.toFixed(4)}`
    return `if(lt(t,${p1.time.toFixed(4)}),${ramp},${segmentExpr(i + 1)})`
  }

  return `if(lt(t,${sorted[0].time.toFixed(4)}),${sorted[0].gain.toFixed(4)},${segmentExpr(0)})`
}

/** Runs `volumedetect` over the already-trimmed range and returns its reported peak, in dBFS (0 = full scale, negative = headroom below it). */
function measurePeakDb(inputPath: string, trimStart: number, trimEnd: number): Promise<number> {
  return new Promise((resolve, reject) => {
    execFile(
      ffmpegBinaryPath(),
      [
        '-y',
        '-ss', trimStart.toFixed(3),
        '-to', trimEnd.toFixed(3),
        '-i', inputPath,
        '-af', 'volumedetect',
        '-f', 'null',
        process.platform === 'win32' ? 'NUL' : '/dev/null',
      ],
      { maxBuffer: 10 * 1024 * 1024 },
      (err, _stdout, stderr) => {
        // ffmpeg with -f null exits 0 even on a successful analysis; `err`
        // here would mean the binary itself failed to run at all.
        if (err && !stderr) {
          reject(err)
          return
        }
        const match = stderr.match(/max_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/)
        resolve(match ? Number(match[1]) : 0)
      },
    )
  })
}

function buildAudioFilterChain(spec: AudioEditSpec, peakGainDb: number): string {
  const parts: string[] = []
  const trimmedDuration = Math.max(0, spec.trimEnd - spec.trimStart)

  parts.push(`atrim=start=${spec.trimStart.toFixed(3)}:end=${spec.trimEnd.toFixed(3)}`, 'asetpts=PTS-STARTPTS')

  if (spec.normalizeMode === 'peak' && Math.abs(peakGainDb) > 0.01) {
    parts.push(`volume=${peakGainDb.toFixed(3)}dB`)
  } else if (spec.normalizeMode === 'loudness') {
    // Single-pass EBU R128 loudness normalization — self-analyzing, no
    // measurement pass needed. Targets a common streaming-style level
    // (-16 LUFS integrated, -1.5 dBTP true peak, 11 LU loudness range) —
    // reasonable defaults for a personal project, not exposed as separate
    // fields since TODO.md only asked for peak-vs-loudness as a mode choice.
    parts.push('loudnorm=I=-16:TP=-1.5:LRA=11')
  }

  if (spec.envelope.length > 0) {
    parts.push(`volume=eval=frame:volume='${buildEnvelopeExpression(spec.envelope)}'`)
  }

  if (spec.fadeInDuration > 0) {
    parts.push(`afade=t=in:st=0:d=${spec.fadeInDuration.toFixed(3)}:curve=${spec.fadeInCurve}`)
  }
  if (spec.fadeOutDuration > 0) {
    const st = Math.max(0, trimmedDuration - spec.fadeOutDuration)
    parts.push(`afade=t=out:st=${st.toFixed(3)}:d=${spec.fadeOutDuration.toFixed(3)}:curve=${spec.fadeOutCurve}`)
  }

  return parts.join(',')
}

/** Renders one committed audio edit to `outputPath` (AAC, matching audioExtractor.ts's convention for derived audio assets). */
export async function renderAudioEdit(inputPath: string, outputPath: string, spec: AudioEditSpec): Promise<void> {
  const peakGainDb = spec.normalizeMode === 'peak' ? -(await measurePeakDb(inputPath, spec.trimStart, spec.trimEnd)) : 0
  const filterChain = buildAudioFilterChain(spec, peakGainDb)

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(ffmpegBinaryPath(), ['-y', '-i', inputPath, '-af', filterChain, '-c:a', 'aac', '-b:a', '192k', outputPath])
    let stderrTail = ''
    proc.stderr.setEncoding('utf-8')
    proc.stderr.on('data', (chunk: string) => {
      stderrTail = (stderrTail + chunk).slice(-4000)
    })
    proc.on('error', (err) => reject(err))
    proc.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`FFmpeg exited with code ${code} while rendering the audio edit.\n${stderrTail}`))
    })
  })
}
