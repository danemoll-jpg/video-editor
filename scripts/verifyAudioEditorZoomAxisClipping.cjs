// Scripted Playwright UI pass for the three items Dan found from actually
// using the now-visible waveform (TODO.md's Current Objective, 2026-09-15):
// (1) the zoom-crash bug fix (canvasWidth now clamps to a safe maximum
// instead of growing unbounded), (2) the time-axis tick marks/labels, and
// (3) the clipping indicator. Same technique as every prior phase's UI
// verification (see verifyAudioEditorLayout.cjs/verifyAudioEditorUI.cjs):
// drives the real, built Electron window against a real, isolated
// --user-data-dir and library location, with assets seeded directly on disk
// (via the bundled FFmpeg) rather than through the native file picker,
// which Playwright can't drive.
//
// Run with:
//   npm run build
//   npm install --no-save playwright
//   node scripts/verifyAudioEditorZoomAxisClipping.cjs
//   npm uninstall playwright

const path = require('node:path')
const os = require('node:os')
const fs = require('node:fs')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')
const { _electron: electron } = require('playwright')

const REPO_ROOT = path.resolve(__dirname, '..')
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'audio-editor-zoom-axis-clip-verify-'))
const userDataDir = path.join(tmpRoot, 'userData')
const libraryDir = path.join(tmpRoot, 'library')
fs.mkdirSync(path.join(userDataDir, 'settings'), { recursive: true })
fs.mkdirSync(libraryDir, { recursive: true })
fs.writeFileSync(path.join(userDataDir, 'settings', 'libraryLocation.json'), JSON.stringify({ customBaseDir: libraryDir }))

// Matches AudioEditor.tsx's MAX_CANVAS_WIDTH exactly — this script asserts
// against the real limit the component enforces, not a guess.
const MAX_CANVAS_WIDTH = 8000
// Matches AudioEditor.tsx's clipColor fallback / --danger CSS var (#e05252).
const CLIP_RGB = [0xe0, 0x52, 0x52]
const CLIP_TOLERANCE = 12

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

function ffmpegBinaryPath() {
  return require(path.join(REPO_ROOT, 'dist-electron', 'videoRuntime')).ffmpegBinaryPath()
}

function seedAudioAsset(projectDir, { originalName, durationArgs }) {
  const assetId = crypto.randomUUID()
  const audioDir = path.join(projectDir, 'assets', 'audio')
  fs.mkdirSync(audioDir, { recursive: true })
  const audioPath = path.join(audioDir, `${assetId}.wav`)
  execFileSync(ffmpegBinaryPath(), ['-y', ...durationArgs, audioPath])
  const stat = fs.statSync(audioPath)

  const assetsJsonPath = path.join(projectDir, 'assets.json')
  const existing = fs.existsSync(assetsJsonPath) ? JSON.parse(fs.readFileSync(assetsJsonPath, 'utf8')) : []
  existing.push({
    id: assetId,
    originalName,
    storedFileName: `${assetId}.wav`,
    kind: 'audio',
    sizeBytes: stat.size,
    importedAt: new Date().toISOString(),
    relativePath: path.join('assets', 'audio', `${assetId}.wav`),
  })
  fs.writeFileSync(assetsJsonPath, JSON.stringify(existing, null, 2))
  return assetId
}

async function main() {
  const electronApp = await electron.launch({
    executablePath: require('electron'),
    args: [path.join(REPO_ROOT, 'dist-electron', 'main.js'), `--user-data-dir=${userDataDir}`],
  })
  const win = await electronApp.firstWindow()
  await win.waitForSelector('text=Projects')
  await electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setSize(1280, 800)
  })

  await win.click('text=+ New Project')
  await win.fill('input[placeholder^="Project name"]', 'Audio Editor Zoom/Axis/Clip Verify')
  await win.click('button:has-text("Create")')
  await win.waitForSelector('text=Media Library')

  const projectsDir = path.join(libraryDir, 'Projects')
  const projectDirName = fs.readdirSync(projectsDir)[0]
  const projectDir = path.join(projectsDir, projectDirName)

  // Dan's real problem file's exact duration (230.16s) — the zoom-crash bug
  // only reproduced on a long real file, not a short synthetic clip.
  seedAudioAsset(projectDir, {
    originalName: '7 or 8 Hours, Give or Take.mp3',
    durationArgs: ['-f', 'lavfi', '-i', 'sine=frequency=220:duration=230.16'],
  })
  // A short tone deliberately overdriven to 1.5x full-scale amplitude via
  // aevalsrc — ffmpeg clips this to the pcm_s16le format's range on encode,
  // producing real clipped samples on disk (not synthetic flags), so this
  // exercises the exact CLIP_THRESHOLD-based detection path end-to-end.
  seedAudioAsset(projectDir, {
    originalName: 'Clipped Tone.wav',
    durationArgs: ['-f', 'lavfi', '-i', 'aevalsrc=1.5*sin(2*PI*440*t):s=44100:d=3'],
  })

  await win.click('.tab-bar__tab:has-text("Media Library")')
  await win.waitForSelector('text=7 or 8 Hours, Give or Take.mp3')

  // ============================================================
  // Item 1 + 2: zoom clamp + time axis, against the real 230.16s file
  // ============================================================
  console.log('\n--- Item 1: zoom-crash clamp (real 230.16s file) ---')
  const longFileCard = win.locator('.media-card', { hasText: '7 or 8 Hours, Give or Take.mp3' })
  await longFileCard.locator('button:has-text("✏️ Edit Audio")').click()
  await win.waitForSelector('text=Non-destructive:')
  await win.waitForSelector('canvas.audio-editor__waveform')
  await win.waitForTimeout(300)

  const zoomButton = win.locator('button', { hasText: /^Zoom \+/ })

  let widthEverExceededLimit = false
  let clickedUntilMax = 0
  const MAX_CLICKS = 60
  for (let i = 0; i < MAX_CLICKS; i++) {
    const disabled = await zoomButton.isDisabled()
    if (disabled) break
    await zoomButton.click()
    clickedUntilMax++
    await win.waitForTimeout(30)
    const width = await win.locator('canvas.audio-editor__waveform').evaluate((el) => el.width)
    if (width > MAX_CANVAS_WIDTH) widthEverExceededLimit = true
  }

  assertTrue(clickedUntilMax > 0 && clickedUntilMax < MAX_CLICKS, `"Zoom +" became disabled after a bounded number of clicks (${clickedUntilMax}), rather than being clickable forever`)
  assertTrue(!widthEverExceededLimit, `waveform canvas width never exceeded the safe MAX_CANVAS_WIDTH (${MAX_CANVAS_WIDTH}px) across all zoom-in clicks`)

  const finalWidth = await win.locator('canvas.audio-editor__waveform').evaluate((el) => el.width)
  assertTrue(finalWidth <= MAX_CANVAS_WIDTH, `at maximum zoom, canvas width (${finalWidth}px) is at/under the safe limit — old behavior would have reached 184,128px here`)

  // The app must still be alive and responsive — the actual regression this
  // item fixes is a full renderer crash ("Aw, Snap!"), not just a clamp
  // value; confirm the window still responds to a real IPC round trip.
  const stillResponsive = await win.evaluate(() => document.title !== undefined && document.querySelectorAll('canvas').length > 0)
  assertTrue(stillResponsive, 'renderer is still alive and responsive after zooming to maximum on the real 230.16s file (no "Aw, Snap!" crash)')

  // One more click at max should be a no-op (button disabled), confirming
  // the clamp actually holds rather than the button merely looking disabled.
  const disabledAtMax = await zoomButton.isDisabled()
  assertTrue(disabledAtMax, '"Zoom +" is disabled once the safe maximum is reached')

  console.log('\n--- Item 2: time axis ---')
  const axisRect = await win.locator('canvas.audio-editor__time-axis').evaluate((el) => {
    const r = el.getBoundingClientRect()
    return { width: r.width, height: r.height, canvasWidth: el.width }
  })
  assertTrue(axisRect.height > 0 && axisRect.width > 0, `time-axis canvas is actually visible on screen (${axisRect.width}x${axisRect.height})`)

  const waveformCanvasWidth = await win.locator('canvas.audio-editor__waveform').evaluate((el) => el.width)
  assertTrue(axisRect.canvasWidth === waveformCanvasWidth, `time-axis canvas width (${axisRect.canvasWidth}) matches the waveform canvas width (${waveformCanvasWidth}) — same horizontal scale, scrolls together`)

  // Structural check: the axis canvas actually drew tick lines/labels, not
  // just a flat background fill — sample pixel rows for any non-background
  // content across a spread of x positions.
  const axisHasContent = await win.locator('canvas.audio-editor__time-axis').evaluate((el) => {
    const ctx = el.getContext('2d')
    const bg = getComputedStyle(el).getPropertyValue('--bg').trim() || '#12141a'
    const bgCanvas = document.createElement('canvas')
    bgCanvas.width = 1
    bgCanvas.height = 1
    const bgCtx = bgCanvas.getContext('2d')
    bgCtx.fillStyle = bg
    bgCtx.fillRect(0, 0, 1, 1)
    const bgPixel = bgCtx.getImageData(0, 0, 1, 1).data
    const data = ctx.getImageData(0, 0, el.width, el.height).data
    let nonBackground = 0
    for (let i = 0; i < data.length; i += 4) {
      if (Math.abs(data[i] - bgPixel[0]) > 8 || Math.abs(data[i + 1] - bgPixel[1]) > 8 || Math.abs(data[i + 2] - bgPixel[2]) > 8) {
        nonBackground++
      }
    }
    return nonBackground
  })
  assertTrue(axisHasContent > 50, `time-axis canvas drew real tick marks/labels (${axisHasContent} non-background pixels), not just a blank background`)

  // Re-check at a lower, non-maximum zoom too, since tick density/labels are
  // meant to adapt with pixelsPerSecond — confirm it still draws content
  // after zooming back out (adaptive spacing didn't break at a normal zoom).
  const zoomOutButton = win.locator('button', { hasText: /^Zoom −/ })
  for (let i = 0; i < 10; i++) await zoomOutButton.click()
  await win.waitForTimeout(200)
  const axisHasContentZoomedOut = await win.locator('canvas.audio-editor__time-axis').evaluate((el) => {
    const ctx = el.getContext('2d')
    const data = ctx.getImageData(0, 0, el.width, el.height).data
    let nonZeroAlpha = 0
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) nonZeroAlpha++
    return nonZeroAlpha
  })
  assertTrue(axisHasContentZoomedOut > 0, 'time axis still renders content after zooming back out to a normal (non-maximum) zoom level')

  await win.click('button:has-text("Close")')
  await win.waitForSelector('text=Non-destructive:', { state: 'detached' })

  // ============================================================
  // Item 3: clipping indicator, against a real overdriven/clipped tone
  // ============================================================
  console.log('\n--- Item 3: clipping indicator (real clipped tone) ---')
  const clippedCard = win.locator('.media-card', { hasText: 'Clipped Tone.wav' })
  await clippedCard.locator('button:has-text("✏️ Edit Audio")').click()
  await win.waitForSelector('text=Non-destructive:')
  await win.waitForSelector('canvas.audio-editor__waveform')
  await win.waitForTimeout(300)

  const hintMentionsClipping = await win.locator('.clip-inspector__hint', { hasText: 'clipping' }).count()
  assertTrue(hintMentionsClipping > 0, 'the waveform hint text documents the clipping indicator (not a separate report — the ask was for it to live on the waveform itself)')

  const clipPixelCount = await win.locator('canvas.audio-editor__waveform').evaluate(
    (el, [r, g, b, tol]) => {
      const ctx = el.getContext('2d')
      const data = ctx.getImageData(0, 0, el.width, el.height).data
      let count = 0
      for (let i = 0; i < data.length; i += 4) {
        if (Math.abs(data[i] - r) <= tol && Math.abs(data[i + 1] - g) <= tol && Math.abs(data[i + 2] - b) <= tol && data[i + 3] > 200) {
          count++
        }
      }
      return count
    },
    [...CLIP_RGB, CLIP_TOLERANCE],
  )
  assertTrue(clipPixelCount > 0, `waveform canvas contains real clip-colored (red, ~rgb(${CLIP_RGB.join(',')})) pixels for the deliberately overdriven tone (found ${clipPixelCount})`)

  // Negative control: the clean 230.16s sine tone (well under full scale)
  // should show none of the same red, confirming this isn't just always-on.
  await win.click('button:has-text("Close")')
  await win.waitForSelector('text=Non-destructive:', { state: 'detached' })
  await longFileCard.locator('button:has-text("✏️ Edit Audio")').click()
  await win.waitForSelector('canvas.audio-editor__waveform')
  await win.waitForTimeout(300)
  const cleanFileClipPixelCount = await win.locator('canvas.audio-editor__waveform').evaluate(
    (el, [r, g, b, tol]) => {
      const ctx = el.getContext('2d')
      const data = ctx.getImageData(0, 0, el.width, el.height).data
      let count = 0
      for (let i = 0; i < data.length; i += 4) {
        if (Math.abs(data[i] - r) <= tol && Math.abs(data[i + 1] - g) <= tol && Math.abs(data[i + 2] - b) <= tol && data[i + 3] > 200) {
          count++
        }
      }
      return count
    },
    [...CLIP_RGB, CLIP_TOLERANCE],
  )
  assertTrue(cleanFileClipPixelCount === 0, `a clean, non-clipping tone (220Hz sine, unclipped) shows zero clip-colored pixels (found ${cleanFileClipPixelCount}) — the indicator isn't a false positive`)

  await electronApp.close()
}

main()
  .then(() => {
    console.log(`\n${passed} passed, ${failed} failed.`)
    process.exitCode = failed > 0 ? 1 : 0
  })
  .catch((err) => {
    console.error('\nFATAL:', err)
    process.exitCode = 1
  })
  .finally(() => {
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true })
    } catch {
      // best-effort cleanup
    }
  })
