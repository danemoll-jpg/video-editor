#!/usr/bin/env node
// Pixel-level verification for src/chromaKey.ts (the live preview's real
// FFmpeg-matching chroma-key algorithm — see that file's header comment).
// Run with: `node scripts/verifyChromaKey.mjs`
//
// Method: build a realistic synthetic clip (green screen, vignette-lit
// background, a skin-tone subject box, per-pixel noise, real H.264
// compression at CRF 18 — the same class of "realistic, noisy footage"
// test this project's chroma-key diagnostic rounds have used before, see
// TODO.md) via this app's own bundled `ffmpeg-static` binary. Then, for the
// exact crop/scale/chromaKey settings a real Clip carries, render two
// versions of the identical crop/scale chain electron/videoExportManager.ts's
// buildVisualChain() uses:
//   "pre"  = crop,scale,format=rgba                (no chromakey — this is
//            what a browser <video>+<canvas> gives the live preview before
//            any keying, i.e. exactly applyChromaKey()'s input)
//   "post" = crop,scale,chromakey=...,format=rgba   (the real filter — this
//            is ground truth: what FFmpeg's actual export produces)
// applyChromaKey() (the new algorithm) and the old hard-RGB-cutoff algorithm
// it replaced are both run against "pre", and each is compared pixel-by-
// pixel against "post"'s real alpha channel.
//
// No fixtures are committed — the synthetic clip is generated fresh each
// run (deterministic given lavfi's fixed seed), so this needs no binary
// test assets in the repo and always exercises whatever ffmpeg-static
// version is actually installed.

import { execFileSync } from 'node:child_process'
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import * as esbuild from 'esbuild'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')
const FFMPEG = path.join(REPO_ROOT, 'node_modules', 'ffmpeg-static', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')

const work = mkdtempSync(path.join(tmpdir(), 'chromakey-verify-'))

function run(args) {
  execFileSync(FFMPEG, args, { stdio: ['ignore', 'ignore', 'pipe'] })
}

// Compile src/chromaKey.ts to a temp ESM module (no committed build
// artifact needed) so this script always tests the real, current source.
async function loadChromaKey() {
  const result = await esbuild.build({
    entryPoints: [path.join(REPO_ROOT, 'src', 'chromaKey.ts')],
    format: 'esm',
    bundle: false,
    write: false,
  })
  const outFile = path.join(work, 'chromaKey.mjs')
  writeFileSync(outFile, result.outputFiles[0].text)
  return import(pathToFileURL(outFile).href)
}

// The OLD (replaced) algorithm, reproduced verbatim from PreviewPlayer.tsx's
// pre-fix drawClipVisual(), for a quantitative before/after comparison
// against the same ground truth.
function applyChromaKeyOld(buf, { color, similarity }) {
  const kr = parseInt(color.slice(1, 3), 16)
  const kg = parseInt(color.slice(3, 5), 16)
  const kb = parseInt(color.slice(5, 7), 16)
  const threshold = similarity * 441.7
  const d = buf.data
  for (let i = 0; i < d.length; i += 4) {
    const dr = d[i] - kr
    const dg = d[i + 1] - kg
    const db = d[i + 2] - kb
    d[i + 3] = Math.sqrt(dr * dr + dg * dg + db * db) < threshold ? 0 : 255
  }
}

function buildSyntheticClip(outPath) {
  // Green background (Dan's real key color) with a vignette lighting
  // falloff, a skin-tone "subject" box overlaid on top (so the subject
  // itself sits on flat, un-vignetted color — vignette only darkens the
  // background, matching real uneven studio lighting), plus per-pixel
  // noise and real H.264 compression — the combination this project's own
  // diagnostic rounds found necessary to reproduce realistic chroma-key
  // edge behavior (see TODO.md's chroma-key root-cause writeup).
  run([
    '-y',
    '-f', 'lavfi', '-i', 'color=c=0x31a05b:s=640x480:d=1',
    '-f', 'lavfi', '-i', 'color=c=0xf5b299:s=200x300:d=1',
    '-filter_complex',
    '[0:v]vignette=PI/4[bgv];[bgv][1:v]overlay=(W-w)/2:(H-h)/2[base];[base]noise=alls=8:allf=t+u[out]',
    '-map', '[out]', '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', '-t', '1',
    outPath,
  ])
}

function extractRaw(inputFile, filt, outName, w, h, timestamps) {
  return timestamps.map((ts) => {
    const out = path.join(work, `${outName}-${ts}.raw`)
    run(['-y', '-ss', String(ts), '-i', inputFile, '-vf', filt, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', out])
    const buf = readFileSync(out)
    return new Uint8ClampedArray(buf.buffer, buf.byteOffset, w * h * 4)
  })
}

function getAlphaChannel(rgba) {
  const n = rgba.length / 4
  const a = new Uint8ClampedArray(n)
  for (let i = 0; i < n; i++) a[i] = rgba[i * 4 + 3]
  return a
}

function alphaStats(mineAlpha, realAlpha) {
  const n = mineAlpha.length
  let sumAbs = 0
  let max = 0
  let within10 = 0
  let within30 = 0
  for (let i = 0; i < n; i++) {
    const d = Math.abs(mineAlpha[i] - realAlpha[i])
    sumAbs += d
    if (d > max) max = d
    if (d <= 10) within10++
    if (d <= 30) within30++
  }
  return { meanAbsDiff: sumAbs / n, maxDiff: max, pctWithin10: (100 * within10) / n, pctWithin30: (100 * within30) / n }
}

async function runCase(applyChromaKey, testCase) {
  const { name, inputFile, crop, scaleW, scaleH, chromaKey, timestamps } = testCase
  const ffmpegColor = `0x${chromaKey.color.replace('#', '')}`
  const cropExpr = crop ? `crop=${crop.width}:${crop.height}:${crop.x}:${crop.y},` : ''
  const preFilter = `${cropExpr}scale=${scaleW}:${scaleH},format=rgba`
  const postFilter = `${cropExpr}scale=${scaleW}:${scaleH},chromakey=color=${ffmpegColor}:similarity=${chromaKey.similarity}:blend=${chromaKey.blend},format=rgba`

  console.log(`\n=== ${name} ===`)
  console.log(`settings: color=${chromaKey.color} similarity=${chromaKey.similarity} blend=${chromaKey.blend}`)

  const preFrames = extractRaw(inputFile, preFilter, 'pre', scaleW, scaleH, timestamps)
  const postFrames = extractRaw(inputFile, postFilter, 'post', scaleW, scaleH, timestamps)

  const newStatsAll = []
  const oldStatsAll = []

  for (let i = 0; i < timestamps.length; i++) {
    const pre = preFrames[i]
    const post = postFrames[i]

    const mineBuf = { width: scaleW, height: scaleH, data: new Uint8ClampedArray(pre) }
    applyChromaKey(mineBuf, chromaKey)
    const mineAlpha = getAlphaChannel(mineBuf.data)

    const oldBuf = { width: scaleW, height: scaleH, data: new Uint8ClampedArray(pre) }
    applyChromaKeyOld(oldBuf, chromaKey)
    const oldAlpha = getAlphaChannel(oldBuf.data)

    const realAlpha = getAlphaChannel(post)

    newStatsAll.push(alphaStats(mineAlpha, realAlpha))
    oldStatsAll.push(alphaStats(oldAlpha, realAlpha))
  }

  const avg = (arr, key) => arr.reduce((s, x) => s + x[key], 0) / arr.length
  const newAvg = { meanAbsDiff: avg(newStatsAll, 'meanAbsDiff'), pctWithin10: avg(newStatsAll, 'pctWithin10'), pctWithin30: avg(newStatsAll, 'pctWithin30') }
  const oldAvg = { meanAbsDiff: avg(oldStatsAll, 'meanAbsDiff'), pctWithin10: avg(oldStatsAll, 'pctWithin10'), pctWithin30: avg(oldStatsAll, 'pctWithin30') }

  console.log(
    `  NEW (chromaKey.ts):  meanAbsAlphaDiff=${newAvg.meanAbsDiff.toFixed(2)}/255  within10=${newAvg.pctWithin10.toFixed(1)}%  within30=${newAvg.pctWithin30.toFixed(1)}%`,
  )
  console.log(
    `  OLD (RGB cutoff):    meanAbsAlphaDiff=${oldAvg.meanAbsDiff.toFixed(2)}/255  within10=${oldAvg.pctWithin10.toFixed(1)}%  within30=${oldAvg.pctWithin30.toFixed(1)}%`,
  )
  console.log(`  improvement: ${(oldAvg.meanAbsDiff / newAvg.meanAbsDiff).toFixed(1)}x lower mean error`)

  return { newAvg, oldAvg }
}

async function main() {
  const { applyChromaKey } = await loadChromaKey()

  const clipPath = path.join(work, 'synth.mp4')
  buildSyntheticClip(clipPath)

  // Case 1: Dan's actual real-world problem settings (color=#31a05b,
  // similarity=0.2, blend=0.1 — see TODO.md's chroma-key root-cause
  // writeup) against a realistic noisy/compressed/vignetted clip.
  await runCase(applyChromaKey, {
    name: 'realistic clip, Dan\'s real problem settings (similarity=0.2 blend=0.1)',
    inputFile: clipPath,
    crop: { width: 500, height: 400, x: 70, y: 40 },
    scaleW: 800,
    scaleH: 640,
    chromaKey: { color: '#31a05b', similarity: 0.2, blend: 0.1 },
    timestamps: [0.1, 0.4, 0.7],
  })

  // Case 2: a cleaner, more typical key (lower similarity, no crop) — the
  // "successful key" case, so the new algorithm's improvement isn't only
  // demonstrated on the one pathological setting.
  await runCase(applyChromaKey, {
    name: 'realistic clip, typical settings (similarity=0.1 blend=0.05)',
    inputFile: clipPath,
    crop: null,
    scaleW: 640,
    scaleH: 480,
    chromaKey: { color: '#31a05b', similarity: 0.1, blend: 0.05 },
    timestamps: [0.2, 0.5],
  })

  console.log('\nDone.')
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => {
    try {
      rmSync(work, { recursive: true, force: true })
    } catch {}
  })
