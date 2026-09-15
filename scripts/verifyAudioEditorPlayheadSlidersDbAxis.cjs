// Scripted Playwright UI pass for the five items from Dan actually using the
// Audio Editor with the waveform now visible (TODO.md's Current Objective,
// 2026-09-15): (1) a real, live-tracking playhead with click-to-seek,
// (2) sliders paired with the trim/fade/split numeric fields, (3) a slider
// for the selected volume-envelope point's gain, (4) a dB/amplitude vertical
// axis, and (5) re-verifying the clipping indicator via that same slider —
// a real interactive action, not a scripted/synthetic overdriven file like
// the prior round's verifyAudioEditorZoomAxisClipping.cjs used. Same
// technique as every prior Audio Editor pass: drives the real, built
// Electron window against a real, isolated --user-data-dir and library
// location, with assets seeded directly on disk via the bundled FFmpeg
// (Playwright can't drive the native file picker).
//
// Run with:
//   npm run build
//   npm install --no-save playwright
//   node scripts/verifyAudioEditorPlayheadSlidersDbAxis.cjs
//   npm uninstall playwright

const path = require('node:path')
const os = require('node:os')
const fs = require('node:fs')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')
const { _electron: electron } = require('playwright')

const REPO_ROOT = path.resolve(__dirname, '..')
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'audio-editor-playhead-sliders-dbaxis-verify-'))
const userDataDir = path.join(tmpRoot, 'userData')
const libraryDir = path.join(tmpRoot, 'library')
fs.mkdirSync(path.join(userDataDir, 'settings'), { recursive: true })
fs.mkdirSync(libraryDir, { recursive: true })
fs.writeFileSync(path.join(userDataDir, 'settings', 'libraryLocation.json'), JSON.stringify({ customBaseDir: libraryDir }))

// Matches AudioEditor.tsx's clipColor fallback / --danger CSS var (#e05252).
const CLIP_RGB = [0xe0, 0x52, 0x52]
const CLIP_TOLERANCE = 12
const DB_AXIS_WIDTH = 44
const TIME_AXIS_HEIGHT = 22
const WAVEFORM_HEIGHT = 140
const ENVELOPE_HEIGHT = 70

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

function countNonBackgroundPixels(el) {
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
}

function countClipPixels(el, rgbTol) {
  const [r, g, b, tol] = rgbTol
  const ctx = el.getContext('2d')
  const data = ctx.getImageData(0, 0, el.width, el.height).data
  let count = 0
  for (let i = 0; i < data.length; i += 4) {
    if (Math.abs(data[i] - r) <= tol && Math.abs(data[i + 1] - g) <= tol && Math.abs(data[i + 2] - b) <= tol && data[i + 3] > 200) {
      count++
    }
  }
  return count
}

/** Sets a <input type="range"> value and fires the events React listens for. */
async function setRangeValue(locator, value) {
  await locator.evaluate((el, v) => {
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    nativeSetter.call(el, String(v))
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }, value)
}

async function readPlayheadSeconds(win) {
  const text = await win.locator('.audio-editor__toolbar .muted').innerText()
  const m = text.match(/Playhead ([\d.]+)s/)
  if (!m) throw new Error(`could not parse playhead from toolbar text: "${text}"`)
  return Number(m[1])
}

async function main() {
  const electronApp = await electron.launch({
    executablePath: require('electron'),
    args: [path.join(REPO_ROOT, 'dist-electron', 'main.js'), `--user-data-dir=${userDataDir}`],
  })
  const win = await electronApp.firstWindow()
  await win.waitForSelector('text=Projects')
  await electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setSize(1280, 900)
  })

  await win.click('text=+ New Project')
  await win.fill('input[placeholder^="Project name"]', 'Audio Editor Playhead/Sliders/dB Verify')
  await win.click('button:has-text("Create")')
  await win.waitForSelector('text=Media Library')

  const projectsDir = path.join(libraryDir, 'Projects')
  const projectDirName = fs.readdirSync(projectsDir)[0]
  const projectDir = path.join(projectsDir, projectDirName)

  // A 10s, moderate-volume tone — long enough to click-to-seek partway
  // through and to see the playhead visibly move during playback, and quiet
  // enough (peak amplitude 0.4) that it does NOT clip at rest, so any red
  // clip coloring found before an edit would be a false positive.
  seedAudioAsset(projectDir, {
    originalName: 'Playhead Test Tone.wav',
    durationArgs: ['-f', 'lavfi', '-i', 'aevalsrc=0.4*sin(2*PI*220*t):s=44100:d=10'],
  })
  // A separate, louder-but-still-safe tone (peak amplitude 0.6) for the
  // envelope/clipping test: unedited, 0.6 peak stays under the 0.999 clip
  // threshold; pushed through the new envelope-point gain slider up to its
  // 2x maximum (0.6 × 2 = 1.2), it genuinely exceeds full scale.
  seedAudioAsset(projectDir, {
    originalName: 'Envelope Clip Test.wav',
    durationArgs: ['-f', 'lavfi', '-i', 'aevalsrc=0.6*sin(2*PI*330*t):s=44100:d=5'],
  })

  await win.click('.tab-bar__tab:has-text("Media Library")')
  await win.waitForSelector('text=Playhead Test Tone.wav')

  // ============================================================
  // Item 1: real playhead — visible, click-to-seek, live during playback
  // ============================================================
  console.log('\n--- Item 1: playhead (visible cursor, click-to-seek, live playback sync) ---')
  const playheadCard = win.locator('.media-card', { hasText: 'Playhead Test Tone.wav' })
  await playheadCard.locator('button:has-text("✏️ Edit Audio")').click()
  await win.waitForSelector('text=Non-destructive:')
  const waveform = win.locator('canvas.audio-editor__waveform')
  await waveform.waitFor()
  await win.waitForTimeout(300)

  const initialPlayhead = await readPlayheadSeconds(win)
  assertTrue(initialPlayhead === 0, `playhead starts at 0s (read "${initialPlayhead}")`)

  const canvasMeta = await waveform.evaluate((el) => ({ width: el.width, rectWidth: el.getBoundingClientRect().width }))
  const pixelsPerSecond = canvasMeta.width / 10 // seeded asset is exactly 10s

  // Plain click ~4s in: should seek the playhead there.
  const clickX = Math.round(4 * pixelsPerSecond)
  await waveform.click({ position: { x: clickX, y: 40 } })
  await win.waitForTimeout(100)
  const afterClickPlayhead = await readPlayheadSeconds(win)
  assertTrue(Math.abs(afterClickPlayhead - 4) < 0.15, `a plain click ~4s in moved the playhead there (read ${afterClickPlayhead}s)`)

  // The waveform canvas should now actually draw a visible white playhead
  // line at that x position, not just update the text readout.
  const hasPlayheadLine = await waveform.evaluate((el, x) => {
    const ctx = el.getContext('2d')
    const data = ctx.getImageData(Math.max(0, x - 2), 0, 5, el.height).data
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] > 240 && data[i + 1] > 240 && data[i + 2] > 240 && data[i + 3] > 200) return true
    }
    return false
  }, clickX)
  assertTrue(hasPlayheadLine, 'a real white playhead line is drawn on the waveform canvas at the seeked position')

  // Drag-select (movement well past the click/drag threshold) should NOT
  // move the playhead, per the "plain click, not a drag" ask.
  const dragStartX = Math.round(1 * pixelsPerSecond)
  const dragEndX = Math.round(2.5 * pixelsPerSecond)
  const waveformBox = await waveform.boundingBox()
  await win.mouse.move(waveformBox.x + dragStartX, waveformBox.y + 40)
  await win.mouse.down()
  await win.mouse.move(waveformBox.x + dragEndX, waveformBox.y + 40, { steps: 8 })
  await win.mouse.up()
  await win.waitForTimeout(100)
  const afterDragPlayhead = await readPlayheadSeconds(win)
  assertTrue(
    Math.abs(afterDragPlayhead - afterClickPlayhead) < 0.05,
    `a drag-select (${dragEndX - dragStartX}px of movement) left the playhead where the earlier click put it (${afterDragPlayhead}s vs ${afterClickPlayhead}s) — only a plain click seeks`,
  )
  const selectionVisible = await win.locator('button:has-text("Trim to Selection")').count()
  assertTrue(selectionVisible > 0, 'the drag instead produced a real trim-range selection ("Trim to Selection" button appeared)')

  // Click-to-seek near the start, then Play: playback should start from
  // there (not always from trimStart/0), and the playhead should visibly
  // advance in real time while playing.
  const seekX = Math.round(1 * pixelsPerSecond)
  await waveform.click({ position: { x: seekX, y: 40 } })
  await win.waitForTimeout(100)
  const seekedPlayhead = await readPlayheadSeconds(win)
  assertTrue(Math.abs(seekedPlayhead - 1) < 0.15, `seeked playhead reads ~1s before pressing Play (${seekedPlayhead}s)`)

  await win.click('button:has-text("▶ Play")')
  await win.waitForTimeout(150)
  const justAfterPlayPlayhead = await readPlayheadSeconds(win)
  assertTrue(
    justAfterPlayPlayhead >= seekedPlayhead - 0.05 && justAfterPlayPlayhead < seekedPlayhead + 1,
    `Play started from the seeked position (~1s), not from the clip's start (playhead reads ${justAfterPlayPlayhead}s just after pressing Play)`,
  )
  await win.waitForTimeout(700)
  const laterPlayhead = await readPlayheadSeconds(win)
  assertTrue(
    laterPlayhead > justAfterPlayPlayhead + 0.2,
    `playhead kept advancing during playback, synced to real playback time (${justAfterPlayPlayhead}s -> ${laterPlayhead}s over ~700ms)`,
  )
  await win.click('button:has-text("⏹ Stop")')
  await win.waitForTimeout(100)

  await win.click('button:has-text("Close")')
  await win.waitForSelector('text=Non-destructive:', { state: 'detached' })

  // ============================================================
  // Items 2-3-4-5: sliders, envelope-point slider, dB axis, clipping re-verify
  // ============================================================
  console.log('\n--- Item 2: sliders paired with trim/fade/split numeric fields ---')
  const clipCard = win.locator('.media-card', { hasText: 'Envelope Clip Test.wav' })
  await clipCard.locator('button:has-text("✏️ Edit Audio")').click()
  await win.waitForSelector('text=Non-destructive:')
  const clipWaveform = win.locator('canvas.audio-editor__waveform')
  await clipWaveform.waitFor()
  await win.waitForTimeout(300)

  const sliderCount = await win.locator('input.audio-editor__slider').count()
  assertTrue(sliderCount >= 5, `at least 5 sliders are present (trim start/end, fade in/out, split) — found ${sliderCount}`)

  // Trim-start slider paired with its numeric field: dragging the slider
  // updates the number field.
  const trimStartNumber = win.locator('.clip-inspector__field', { hasText: 'Start (s)' }).locator('input[type="number"]')
  const trimStartSlider = win
    .locator('.audio-editor__field-with-slider', { has: win.locator('text=Start (s)') })
    .locator('input.audio-editor__slider')
  await setRangeValue(trimStartSlider, 0.5)
  await win.waitForTimeout(50)
  const trimStartNumberValue = Number(await trimStartNumber.inputValue())
  assertTrue(Math.abs(trimStartNumberValue - 0.5) < 0.02, `dragging the Trim Start slider to 0.5 updated the paired numeric field (read ${trimStartNumberValue})`)

  // And the reverse: typing in the numeric field updates the slider.
  await trimStartNumber.fill('0.2')
  await trimStartNumber.blur()
  await win.waitForTimeout(50)
  const trimStartSliderValue = Number(await trimStartSlider.inputValue())
  assertTrue(Math.abs(trimStartSliderValue - 0.2) < 0.02, `typing 0.2 into the Trim Start numeric field updated the paired slider (read ${trimStartSliderValue})`)
  await trimStartNumber.fill('0')
  await trimStartNumber.blur()

  // Fade-in slider bound to a sensible real range (the clip's own duration).
  const fadeInSlider = win
    .locator('.audio-editor__field-with-slider', { has: win.locator('text=Fade in (s)') })
    .locator('input.audio-editor__slider')
  const fadeInMax = Number(await fadeInSlider.getAttribute('max'))
  assertTrue(fadeInMax > 0 && fadeInMax <= 5.01, `Fade In slider's max (${fadeInMax}) is bound to the clip's real duration (5s), not an arbitrary/unbounded range`)

  console.log('\n--- Item 4: dB/amplitude vertical axis ---')
  const dbAxis = win.locator('canvas.audio-editor__db-axis')
  const dbAxisMeta = await dbAxis.evaluate((el) => ({
    width: el.width,
    height: el.height,
    rect: el.getBoundingClientRect(),
  }))
  assertTrue(dbAxisMeta.width === DB_AXIS_WIDTH, `dB axis canvas has the expected fixed width (${DB_AXIS_WIDTH}px, read ${dbAxisMeta.width})`)
  assertTrue(
    dbAxisMeta.height === TIME_AXIS_HEIGHT + WAVEFORM_HEIGHT + ENVELOPE_HEIGHT,
    `dB axis canvas spans the full stacked height of time-axis + waveform + envelope (read ${dbAxisMeta.height})`,
  )
  assertTrue(dbAxisMeta.rect.width > 0 && dbAxisMeta.rect.height > 0, `dB axis canvas is actually visible on screen (${dbAxisMeta.rect.width}x${dbAxisMeta.rect.height})`)
  const dbAxisContent = await dbAxis.evaluate(countNonBackgroundPixels)
  assertTrue(dbAxisContent > 20, `dB axis canvas drew real gridlines/labels (${dbAxisContent} non-background pixels), not a blank fill`)

  console.log('\n--- Item 3 + 5: envelope-point gain slider, and re-verifying clipping via a real interactive action ---')
  const baselineClipPixels = await clipWaveform.evaluate(countClipPixels, [...CLIP_RGB, CLIP_TOLERANCE])
  assertTrue(baselineClipPixels === 0, `before any edit, the 0.6-peak-amplitude tone shows zero clip-red pixels (found ${baselineClipPixels}) — a valid non-clipping baseline`)

  // Click the envelope strip mid-way to add a point (which also selects it,
  // per item 3's "click a point once to select it" — a brand-new point is
  // selected immediately on creation).
  const envelopeStrip = win.locator('canvas.audio-editor__envelope-strip')
  const envelopeBox = await envelopeStrip.boundingBox()
  await win.mouse.click(envelopeBox.x + envelopeBox.width / 2, envelopeBox.y + envelopeBox.height / 2)
  await win.waitForTimeout(100)

  const selectedPointSlider = win.locator('.audio-editor__selected-point input.audio-editor__slider')
  assertTrue(await selectedPointSlider.count() > 0, 'selecting an envelope point revealed its own gain slider (item 3)')

  const sliderMax = Number(await selectedPointSlider.getAttribute('max'))
  assertTrue(sliderMax === 2, `selected-point slider's max (${sliderMax}) matches the envelope's real gain ceiling (2x = +6dB)`)

  // The actual re-verification ask: push this real interactive slider all
  // the way up and confirm the already-built clipping indicator lights up —
  // not a scripted synthetic overdriven file like last round's test.
  await setRangeValue(selectedPointSlider, 2)
  await win.waitForTimeout(150)

  const gainLabel = await win.locator('.audio-editor__selected-point .muted').innerText()
  assertTrue(gainLabel.includes('2.00'), `selected point's gain readout reflects the slider (read "${gainLabel}")`)

  const clipPixelsAfterSlider = await clipWaveform.evaluate(countClipPixels, [...CLIP_RGB, CLIP_TOLERANCE])
  assertTrue(
    clipPixelsAfterSlider > 0,
    `dragging the envelope-point gain slider to its maximum (2x) made the already-built red clipping indicator show up (${clipPixelsAfterSlider} clip-red pixels) — confirmed via the real slider UI, not a synthetic file`,
  )

  // Negative control within the same session: pull the same slider back
  // down to unity gain and confirm the clip coloring disappears again,
  // ruling out a stuck/always-on indicator.
  await setRangeValue(selectedPointSlider, 1)
  await win.waitForTimeout(150)
  const clipPixelsAfterReset = await clipWaveform.evaluate(countClipPixels, [...CLIP_RGB, CLIP_TOLERANCE])
  assertTrue(clipPixelsAfterReset === 0, `pulling the same slider back to unity gain (1x) removed the clip coloring again (found ${clipPixelsAfterReset}) — not a stuck indicator`)

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
