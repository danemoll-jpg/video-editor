// Scripted integration test for Phase 7 (Export Tools) — exercises the real,
// compiled ProjectManager/EditorManager/VideoExportManager code (from
// dist-electron/, after `npm run build`) through the real bundled FFmpeg
// binary, run inside a real (headless) Electron process since projectPaths.ts
// now needs app.getPath() — same pattern as every prior phase's manager-
// level scripted verification (see TODO.md), just extended to cover the
// three new export entry points (exportClip/exportGif/exportStillFrame)
// rather than re-testing exportMp4's existing Phase 6 coverage.
//
// Isolated from Dan's real library the same way the Phase 6 UI-verification
// passes were: app.getPath('userData')/('documents') are both repointed at a
// throwaway temp folder before anything reads them, so this can never touch
// his real projects. Not committed as an automated test suite (consistent
// with every prior phase's "still not done" note) — a one-off verification
// script, run manually with:
//
//   npm run build
//   node_modules/.bin/electron scripts/verifyExportTools.cjs
//
// (or, on Windows, `node_modules\.bin\electron.cmd` — see the command this
// round's own verification used).

const path = require('node:path')
const os = require('node:os')
const fs = require('node:fs')
const { execFileSync } = require('node:child_process')

const REPO_ROOT = path.resolve(__dirname, '..')
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'export-tools-verify-'))
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

// editorManager.js (transitively) imports mediaProtocol.js, which calls
// protocol.registerSchemesAsPrivileged() at module-load time — Electron
// requires that to happen before the app is 'ready', so these are required
// synchronously up front rather than lazily inside main() below.
const { ProjectManager } = require(path.join(REPO_ROOT, 'dist-electron', 'projectManager'))
const { EditorManager } = require(path.join(REPO_ROOT, 'dist-electron', 'editorManager'))
const { VideoExportManager } = require(path.join(REPO_ROOT, 'dist-electron', 'videoExportManager'))

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

function ffprobeJson(filePath, extraArgs) {
  const { ffprobeBinaryPath } = require(path.join(REPO_ROOT, 'dist-electron', 'videoRuntime'))
  const out = execFileSync(ffprobeBinaryPath(), ['-v', 'error', '-print_format', 'json', ...extraArgs, filePath])
  return JSON.parse(out.toString('utf-8'))
}

/** Builds a short real test clip (color bars + a tone, via lavfi) using the app's own bundled FFmpeg — no binary fixtures needed, same technique verifyChromaKey.mjs uses. */
function buildTestClip(outPath, durationSec) {
  const { ffmpegBinaryPath } = require(path.join(REPO_ROOT, 'dist-electron', 'videoRuntime'))
  execFileSync(ffmpegBinaryPath(), [
    '-y',
    '-f',
    'lavfi',
    '-i',
    `testsrc=size=320x180:rate=30:duration=${durationSec}`,
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=440:duration=${durationSec}`,
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    outPath,
  ])
}

async function main() {
  const projectManager = new ProjectManager()
  const editorManager = new EditorManager(projectManager)
  const videoExportManager = new VideoExportManager(projectManager, editorManager)

  console.log('Setting up a throwaway project with a real 6s test clip…')
  const project = await projectManager.createProject('Export Tools Verify')

  const clipSrcPath = path.join(tmpRoot, 'source.mp4')
  buildTestClip(clipSrcPath, 6)
  const [asset] = await projectManager.importAssets(project.id, [clipSrcPath])
  assertTrue(!!asset, 'test asset imported')

  const timeline = await editorManager.getTimeline(project.id)
  const videoTrack = timeline.tracks.find((t) => t.type === 'video')
  assertTrue(!!videoTrack, 'default project timeline has a video track')

  const afterAdd = await editorManager.addClip(project.id, {
    trackId: videoTrack.id,
    assetId: asset.id,
    kind: 'media',
    startTime: 0,
  })
  const clip = afterAdd.clips.find((c) => c.assetId === asset.id)
  assertTrue(!!clip, 'clip added to timeline')
  assertClose(clip.duration, 6, 0.2, 'added clip spans the full 6s source')

  // --- exportClip -----------------------------------------------------------
  console.log('\nexportClip: a 2s window (1s..3s) as a standalone MP4…')
  {
    const { outputPath } = await videoExportManager.exportClip(project.id, 'clip-test', { start: 1, end: 3 }, () => {}, tmpRoot)
    assertTrue(fs.existsSync(outputPath), 'clip export file exists')
    const info = ffprobeJson(outputPath, ['-show_entries', 'format=duration:stream=width,height,codec_type'])
    const duration = Number(info.format.duration)
    assertClose(duration, 2, 0.3, 'clip export duration is ~2s (the selected range), not the full 6s')
    const vStream = info.streams.find((s) => s.codec_type === 'video')
    assertTrue(vStream.width === timeline.projectSettings.width && vStream.height === timeline.projectSettings.height, 'clip export resolution matches the project canvas')
    const aStream = info.streams.find((s) => s.codec_type === 'audio')
    assertTrue(!!aStream, 'clip export still has an audio stream')
  }

  // --- exportClip range validation -------------------------------------------
  console.log('\nexportClip: rejects an invalid (end <= start) range…')
  {
    let threw = false
    try {
      await videoExportManager.exportClip(project.id, 'bad-range', { start: 3, end: 3 }, () => {}, tmpRoot)
    } catch {
      threw = true
    }
    assertTrue(threw, 'end === start range is rejected rather than silently producing a zero-length export')
  }

  console.log('\nexportClip: rejects a range with no clips in it…')
  {
    let threw = false
    try {
      await videoExportManager.exportClip(project.id, 'empty-range', { start: 100, end: 105 }, () => {}, tmpRoot)
    } catch {
      threw = true
    }
    assertTrue(threw, 'a range entirely past every clip is rejected with a clear error, not a crash')
  }

  // --- exportGif --------------------------------------------------------------
  console.log('\nexportGif: a 2s window, custom dimensions/fps, loop=true…')
  {
    const { outputPath } = await videoExportManager.exportGif(
      project.id,
      'gif-test-loop',
      { range: { start: 0, end: 2 }, width: 160, height: 90, fps: 10, quality: 'medium', loop: true },
      () => {},
      tmpRoot,
    )
    assertTrue(fs.existsSync(outputPath), 'GIF export file exists')
    const buf = fs.readFileSync(outputPath)
    assertTrue(buf.slice(0, 3).toString('ascii') === 'GIF', 'output file is actually a GIF (magic bytes)')
    assertTrue(buf.includes('NETSCAPE2.0'), 'loop=true GIF carries the looping application extension')
    const info = ffprobeJson(outputPath, ['-show_entries', 'stream=width,height,codec_type,nb_read_frames', '-count_frames'])
    const vStream = info.streams.find((s) => s.codec_type === 'video')
    assertTrue(vStream.width === 160 && vStream.height === 90, 'GIF export honors the requested custom dimensions, independent of the project canvas')
    const frameCount = Number(vStream.nb_read_frames)
    assertClose(frameCount, 20, 3, 'GIF export honors the requested fps (10fps * 2s ≈ 20 frames)')
  }

  console.log('\nexportGif: loop=false (play once)…')
  {
    const { outputPath } = await videoExportManager.exportGif(
      project.id,
      'gif-test-once',
      { range: { start: 0, end: 1 }, width: 120, height: 68, fps: 8, quality: 'low', loop: false },
      () => {},
      tmpRoot,
    )
    const buf = fs.readFileSync(outputPath)
    assertTrue(!buf.includes('NETSCAPE2.0'), 'loop=false GIF has no looping application extension (plays once)')
  }

  console.log('\nexportGif: aspect-ratio-locked dimensions from the ExportDialog UI math produce even, valid output…')
  {
    // Mirrors ExportDialog.tsx's evenRound(width * canvasH / canvasW) — the
    // project canvas here is the default 1920x1080, so a 480-wide GIF should
    // come out 270 tall.
    const canvasW = timeline.projectSettings.width
    const canvasH = timeline.projectSettings.height
    const width = 480
    const height = Math.max(2, Math.round(((width * canvasH) / canvasW) / 2) * 2)
    const { outputPath } = await videoExportManager.exportGif(
      project.id,
      'gif-test-aspect',
      { range: { start: 0, end: 1 }, width, height, fps: 10, quality: 'high', loop: true },
      () => {},
      tmpRoot,
    )
    const info = ffprobeJson(outputPath, ['-show_entries', 'stream=width,height,codec_type'])
    const vStream = info.streams.find((s) => s.codec_type === 'video')
    assertTrue(vStream.width === width && vStream.height === height, `aspect-locked GIF dims came out ${vStream.width}x${vStream.height}, expected ${width}x${height}`)
  }

  // --- exportStillFrame --------------------------------------------------------
  console.log('\nexportStillFrame: a single PNG at t=1.5s…')
  {
    const { outputPath } = await videoExportManager.exportStillFrame(project.id, 'frame-test', { time: 1.5, format: 'png' }, tmpRoot)
    assertTrue(fs.existsSync(outputPath), 'still-frame PNG exists')
    const buf = fs.readFileSync(outputPath)
    assertTrue(buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'output file is actually a PNG (magic bytes)')
    const info = ffprobeJson(outputPath, ['-show_entries', 'stream=width,height,codec_type'])
    const vStream = info.streams.find((s) => s.codec_type === 'video')
    assertTrue(vStream.width === timeline.projectSettings.width && vStream.height === timeline.projectSettings.height, 'still-frame resolution matches the project canvas')
  }

  console.log('\nexportStillFrame: a single JPEG at t=0.2s…')
  {
    const { outputPath } = await videoExportManager.exportStillFrame(project.id, 'frame-test-jpg', { time: 0.2, format: 'jpg' }, tmpRoot)
    assertTrue(fs.existsSync(outputPath), 'still-frame JPEG exists')
    const buf = fs.readFileSync(outputPath)
    assertTrue(buf[0] === 0xff && buf[1] === 0xd8, 'output file is actually a JPEG (magic bytes)')
  }

  // --- Range clamping through an active transition ------------------------
  console.log('\nexportClip: a range that cuts through an active transition clears it instead of crashing…')
  {
    const clipSrcPath2 = path.join(tmpRoot, 'source2.mp4')
    buildTestClip(clipSrcPath2, 4)
    const [asset2] = await projectManager.importAssets(project.id, [clipSrcPath2])
    const withTrack2 = await editorManager.addTrack(project.id, 'video')
    const videoTrack2 = withTrack2.tracks.find((t) => t.id !== videoTrack.id && t.type === 'video')
    // Two clips on their own track, back-to-back with a Cross Dissolve
    // transition between them, so the transition's overlap window sits
    // right around t=5..5.5 on the main video track.
    const withClipA = await editorManager.updateClip(project.id, clip.id, {
      transitionOut: { type: 'fade', duration: 0.5 },
    })
    const secondClip = await editorManager.addClip(project.id, {
      trackId: videoTrack.id,
      assetId: asset2.id,
      kind: 'media',
      startTime: clip.duration - 0.5,
    })
    assertTrue(secondClip.clips.some((c) => c.assetId === asset2.id), 'second (transitioned) clip added')

    let threw = false
    try {
      const { outputPath } = await videoExportManager.exportClip(project.id, 'transition-cut-test', { start: 5.2, end: 6.5 }, () => {}, tmpRoot)
      assertTrue(fs.existsSync(outputPath), 'a range cutting through the transition overlap still produces a valid file')
    } catch (err) {
      threw = true
      console.error('    (unexpected throw)', err)
    }
    assertTrue(!threw, 'range clamping through an active transition does not crash the export')
    void withClipA
    void videoTrack2
  }

  console.log('\nAll export-tools scenarios exercised.')
}
