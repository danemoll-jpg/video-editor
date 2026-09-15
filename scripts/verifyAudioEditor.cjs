// Scripted integration test for the Audio Editor (TODO.md, 2026-09-15) —
// exercises the real, compiled ProjectManager.commitAudioEdit/splitAudioAsset
// (from dist-electron/, after `npm run build`) through the real bundled
// FFmpeg binary, same pattern as scripts/verifyExportTools.cjs: a real
// (headless) Electron process since projectPaths.ts needs app.getPath(),
// isolated from Dan's real library via throwaway userData/documents dirs.
//
// Not committed as an automated test suite (same caveat as every prior
// phase's scripted verification) — a one-off, run manually with:
//
//   npm run build
//   node_modules\.bin\electron.cmd scripts\verifyAudioEditor.cjs   (Windows)
//   node_modules/.bin/electron scripts/verifyAudioEditor.cjs        (macOS/Linux)

const path = require('node:path')
const os = require('node:os')
const fs = require('node:fs')
const crypto = require('node:crypto')
const { execFileSync, execFile } = require('node:child_process')

const REPO_ROOT = path.resolve(__dirname, '..')
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'audio-editor-verify-'))
const userDataDir = path.join(tmpRoot, 'userData')
const documentsDir = path.join(tmpRoot, 'documents')
fs.mkdirSync(userDataDir, { recursive: true })
fs.mkdirSync(documentsDir, { recursive: true })

let passed = 0
let failed = 0
function assertTrue(cond, msg) {
  if (cond) {
    passed++
    console.log(`  ok — ${msg}`)
  } else {
    failed++
    console.error(`  FAIL — ${msg}`)
  }
}
function assertClose(actual, expected, tolerance, msg) {
  assertTrue(Math.abs(actual - expected) <= tolerance, `${msg} (expected ~${expected}, got ${actual})`)
}

const { app } = require('electron')
app.setPath('userData', userDataDir)
app.setPath('documents', documentsDir)

// editorManager.js (transitively required by projectManager's peers) touches
// mediaProtocol.js at module-load time, which registers a privileged scheme —
// Electron requires that before 'ready', so require everything synchronously
// up front, same as verifyExportTools.cjs.
const { ProjectManager } = require(path.join(REPO_ROOT, 'dist-electron', 'projectManager'))
const { ffmpegBinaryPath } = require(path.join(REPO_ROOT, 'dist-electron', 'videoRuntime'))

app.whenReady().then(async () => {
  try {
    await main()
    console.log(`\n${passed} passed, ${failed} failed.`)
    process.exitCode = failed > 0 ? 1 : 0
  } catch (err) {
    console.error('\nFATAL:', err)
    process.exitCode = 1
  } finally {
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true })
    } catch {
      // best-effort cleanup
    }
    app.quit()
  }
})

/** Builds a real test tone via lavfi (no binary fixtures needed) at a reduced gain, so peak-normalize has real headroom to close — the exact resulting dBFS isn't asserted on directly, just that it's well below 0dB (confirmed at measurement time) and that normalizing measurably closes that gap. */
function buildTestTone(outPath, durationSec, amplitude) {
  execFileSync(ffmpegBinaryPath(), [
    '-y',
    '-f', 'lavfi',
    '-i', `sine=frequency=440:duration=${durationSec}:sample_rate=48000`,
    '-af', `volume=${amplitude}`,
    '-c:a', 'pcm_s16le',
    outPath,
  ])
}

function measureMeanVolumeDb(filePath, start, end) {
  return new Promise((resolve, reject) => {
    execFile(
      ffmpegBinaryPath(),
      ['-y', '-ss', String(start), '-to', String(end), '-i', filePath, '-af', 'volumedetect', '-f', 'null', process.platform === 'win32' ? 'NUL' : '/dev/null'],
      { maxBuffer: 10 * 1024 * 1024 },
      (err, _stdout, stderr) => {
        if (err && !stderr) return reject(err)
        const match = stderr.match(/mean_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/)
        resolve(match ? Number(match[1]) : null)
      },
    )
  })
}

function measurePeakDb(filePath) {
  return new Promise((resolve, reject) => {
    execFile(
      ffmpegBinaryPath(),
      ['-y', '-i', filePath, '-af', 'volumedetect', '-f', 'null', process.platform === 'win32' ? 'NUL' : '/dev/null'],
      { maxBuffer: 10 * 1024 * 1024 },
      (err, _stdout, stderr) => {
        if (err && !stderr) return reject(err)
        const match = stderr.match(/max_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/)
        resolve(match ? Number(match[1]) : null)
      },
    )
  })
}

function measureIntegratedLoudness(filePath) {
  return new Promise((resolve, reject) => {
    execFile(
      ffmpegBinaryPath(),
      ['-y', '-i', filePath, '-af', 'loudnorm=print_format=json', '-f', 'null', process.platform === 'win32' ? 'NUL' : '/dev/null'],
      { maxBuffer: 10 * 1024 * 1024 },
      (err, _stdout, stderr) => {
        if (err && !stderr) return reject(err)
        const jsonMatch = stderr.match(/\{[\s\S]*\}/)
        if (!jsonMatch) return resolve(null)
        try {
          const data = JSON.parse(jsonMatch[0])
          resolve(Number(data.input_i))
        } catch {
          resolve(null)
        }
      },
    )
  })
}

function durationOf(filePath) {
  const out = execFileSync(require(path.join(REPO_ROOT, 'dist-electron', 'videoRuntime')).ffprobeBinaryPath(), [
    '-v', 'error', '-print_format', 'json', '-show_format', filePath,
  ])
  return Number(JSON.parse(out.toString('utf-8')).format.duration)
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

async function main() {
  const projectManager = new ProjectManager()

  console.log('Setting up a throwaway project with a real 6s -6dBFS test tone…')
  const project = await projectManager.createProject('Audio Editor Verify')

  const tonePath = path.join(tmpRoot, 'tone.wav')
  buildTestTone(tonePath, 6, 0.5) // amplitude 0.5 ≈ -6 dBFS peak
  const [audioAsset] = await projectManager.importAssets(project.id, [tonePath])
  assertTrue(audioAsset.kind === 'audio', 'test tone imported as an audio asset')

  const videoPath = path.join(tmpRoot, 'video.mp4')
  execFileSync(ffmpegBinaryPath(), ['-y', '-f', 'lavfi', '-i', 'testsrc=size=64x64:rate=10:duration=1', videoPath])
  const afterVideoImport = await projectManager.importAssets(project.id, [videoPath])
  const videoAsset = afterVideoImport[afterVideoImport.length - 1]

  const originalAbsPath = await projectManager.getAssetAbsolutePath(project.id, audioAsset.id)
  const originalHashBefore = sha256(originalAbsPath)

  // --- Rejects non-audio assets --------------------------------------------
  console.log('\ncommitAudioEdit: rejects a non-audio asset…')
  {
    let threw = false
    try {
      await projectManager.commitAudioEdit(project.id, videoAsset.id, {
        trimStart: 0, trimEnd: 1, fadeInDuration: 0, fadeInCurve: 'tri', fadeOutDuration: 0, fadeOutCurve: 'tri', envelope: [], normalizeMode: 'none',
      })
    } catch {
      threw = true
    }
    assertTrue(threw, 'a video asset is rejected — the Audio Editor only edits audio assets')
  }

  // --- Trim ------------------------------------------------------------------
  console.log('\ncommitAudioEdit: trims to a 2s window (1s..3s), no fades/envelope/normalize…')
  let trimmedAssets
  {
    trimmedAssets = await projectManager.commitAudioEdit(project.id, audioAsset.id, {
      trimStart: 1, trimEnd: 3, fadeInDuration: 0, fadeInCurve: 'tri', fadeOutDuration: 0, fadeOutCurve: 'tri', envelope: [], normalizeMode: 'none',
    })
    const newAsset = trimmedAssets[trimmedAssets.length - 1]
    assertTrue(newAsset.id !== audioAsset.id, 'commit produced a brand-new asset id, not the original')
    assertTrue(newAsset.originalName.includes('(edited)'), 'derived asset is named distinctly from the source')
    const absPath = await projectManager.getAssetAbsolutePath(project.id, newAsset.id)
    assertClose(durationOf(absPath), 2, 0.15, 'trimmed output duration is ~2s')
  }

  // --- Non-destructiveness ----------------------------------------------------
  console.log('\nNon-destructiveness: the original source file is untouched after a commit…')
  {
    assertTrue(fs.existsSync(originalAbsPath), 'original source file still exists on disk')
    assertTrue(sha256(originalAbsPath) === originalHashBefore, 'original source file bytes are unchanged (hash match)')
  }

  // --- Rejects an invalid trim range -----------------------------------------
  console.log('\ncommitAudioEdit: rejects trimEnd <= trimStart…')
  {
    let threw = false
    try {
      await projectManager.commitAudioEdit(project.id, audioAsset.id, {
        trimStart: 3, trimEnd: 3, fadeInDuration: 0, fadeInCurve: 'tri', fadeOutDuration: 0, fadeOutCurve: 'tri', envelope: [], normalizeMode: 'none',
      })
    } catch {
      threw = true
    }
    assertTrue(threw, 'an empty/inverted trim range is rejected rather than producing a zero-length file')
  }

  // --- Fade in/out -------------------------------------------------------------
  console.log('\ncommitAudioEdit: fade in + fade out (1s each, linear) measurably quiet the clip edges…')
  {
    const faded = await projectManager.commitAudioEdit(project.id, audioAsset.id, {
      trimStart: 0, trimEnd: 6, fadeInDuration: 1, fadeInCurve: 'tri', fadeOutDuration: 1, fadeOutCurve: 'tri', envelope: [], normalizeMode: 'none',
    })
    const newAsset = faded[faded.length - 1]
    const absPath = await projectManager.getAssetAbsolutePath(project.id, newAsset.id)

    const startDb = await measureMeanVolumeDb(absPath, 0, 0.2)
    const midDb = await measureMeanVolumeDb(absPath, 2.9, 3.1)
    const endDb = await measureMeanVolumeDb(absPath, 5.8, 6.0)
    assertTrue(midDb - startDb > 6, `fade-in measurably quieter near t=0 than mid-clip (start=${startDb}dB, mid=${midDb}dB)`)
    assertTrue(midDb - endDb > 6, `fade-out measurably quieter near the end than mid-clip (end=${endDb}dB, mid=${midDb}dB)`)
  }

  // --- Volume envelope ----------------------------------------------------------
  console.log('\ncommitAudioEdit: a 3-point volume envelope (quiet/loud/quiet) is audible in the render…')
  {
    const enveloped = await projectManager.commitAudioEdit(project.id, audioAsset.id, {
      trimStart: 0,
      trimEnd: 6,
      fadeInDuration: 0,
      fadeInCurve: 'tri',
      fadeOutDuration: 0,
      fadeOutCurve: 'tri',
      envelope: [
        { time: 0, gain: 0.1 },
        { time: 3, gain: 1.0 },
        { time: 6, gain: 0.1 },
      ],
      normalizeMode: 'none',
    })
    const newAsset = enveloped[enveloped.length - 1]
    const absPath = await projectManager.getAssetAbsolutePath(project.id, newAsset.id)

    const quietStartDb = await measureMeanVolumeDb(absPath, 0, 0.15)
    const loudMidDb = await measureMeanVolumeDb(absPath, 2.9, 3.1)
    const quietEndDb = await measureMeanVolumeDb(absPath, 5.85, 6.0)
    assertTrue(loudMidDb - quietStartDb > 12, `envelope peak (t=3, gain 1.0) is much louder than its quiet start (gain 0.1) — start=${quietStartDb}dB mid=${loudMidDb}dB`)
    assertTrue(loudMidDb - quietEndDb > 12, `envelope peak (t=3, gain 1.0) is much louder than its quiet end (gain 0.1) — end=${quietEndDb}dB mid=${loudMidDb}dB`)
  }

  // --- Normalize: peak -----------------------------------------------------------
  console.log('\ncommitAudioEdit: peak normalize brings the loudest sample close to 0 dBFS…')
  {
    const before = await measurePeakDb(originalAbsPath)
    assertTrue(before < -3, `source tone has real headroom before normalizing (measured ${before}dB)`)
    const normalized = await projectManager.commitAudioEdit(project.id, audioAsset.id, {
      trimStart: 0, trimEnd: 6, fadeInDuration: 0, fadeInCurve: 'tri', fadeOutDuration: 0, fadeOutCurve: 'tri', envelope: [], normalizeMode: 'peak',
    })
    const newAsset = normalized[normalized.length - 1]
    const absPath = await projectManager.getAssetAbsolutePath(project.id, newAsset.id)
    const after = await measurePeakDb(absPath)
    assertClose(after, 0, 1.0, `peak-normalized output peak is close to 0dBFS (was ${before}dB)`)
  }

  // --- Normalize: loudness ---------------------------------------------------------
  console.log('\ncommitAudioEdit: loudness normalize moves integrated loudness toward -16 LUFS…')
  {
    const normalized = await projectManager.commitAudioEdit(project.id, audioAsset.id, {
      trimStart: 0, trimEnd: 6, fadeInDuration: 0, fadeInCurve: 'tri', fadeOutDuration: 0, fadeOutCurve: 'tri', envelope: [], normalizeMode: 'loudness',
    })
    const newAsset = normalized[normalized.length - 1]
    const absPath = await projectManager.getAssetAbsolutePath(project.id, newAsset.id)
    const measured = await measureIntegratedLoudness(absPath)
    assertTrue(measured !== null, 'loudnorm single-pass analysis produced a readable integrated-loudness measurement')
    if (measured !== null) assertClose(measured, -16, 2.5, 'loudness-normalized output is close to the -16 LUFS target')
  }

  // --- Split -------------------------------------------------------------------------
  console.log('\nsplitAudioAsset: splits the 6s tone at 2.5s into two independent assets…')
  {
    const before = await projectManager.listAssets(project.id)
    const split = await projectManager.splitAudioAsset(project.id, audioAsset.id, 2.5)
    assertTrue(split.length === before.length + 2, 'exactly two new assets were added')
    const [partA, partB] = split.slice(-2)
    const absA = await projectManager.getAssetAbsolutePath(project.id, partA.id)
    const absB = await projectManager.getAssetAbsolutePath(project.id, partB.id)
    assertClose(durationOf(absA), 2.5, 0.15, 'first half duration is ~2.5s')
    assertClose(durationOf(absB), 3.5, 0.15, 'second half duration is ~3.5s')
    assertTrue(fs.existsSync(originalAbsPath) && sha256(originalAbsPath) === originalHashBefore, 'original source untouched after split too')
  }

  console.log('\nsplitAudioAsset: rejects a split point at/outside the clip bounds…')
  {
    let threwAtZero = false
    try {
      await projectManager.splitAudioAsset(project.id, audioAsset.id, 0)
    } catch {
      threwAtZero = true
    }
    assertTrue(threwAtZero, 'split at exactly 0 is rejected (nothing would be in the first half)')

    let threwPastEnd = false
    try {
      await projectManager.splitAudioAsset(project.id, audioAsset.id, 999)
    } catch {
      threwPastEnd = true
    }
    assertTrue(threwPastEnd, 'split past the clip end is rejected')
  }

  console.log('\nAll Audio Editor scenarios exercised.')
}
