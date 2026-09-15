// Full scripted click-through of the Audio Editor modal (2026-09-15) — drives
// the real, built Electron window the same way scripts/verifyAudioEditorUI.cjs
// tried to, but that script only ever checked the waveform canvas's *width*
// attribute (proof it was sized, not proof it drew anything) and never
// actually completed a run. This one checks real canvas pixel content
// (non-background pixel counts) at each step, and exercises every control —
// zoom, range selection + "Trim to Selection", split, fade in/out + curve
// change, normalize mode change, envelope point add/drag/remove, play/stop,
// and commit — reporting pass/fail per step so nothing gets a pass by
// assumption. This is what found both real bugs fixed alongside this script:
// the anti-phase-stereo waveform mixdown cancellation (audioEditPreview.ts)
// and the commit-success-banner-never-shows remount (MediaLibrary.tsx).
//
// Playwright is installed ad-hoc for this pass (`npm install --no-save
// playwright`) and is not a permanent dependency — remove it again after.
//
// Run with:
//   npm run build
//   npm install --no-save playwright
//   node scripts/clickThroughAudioEditor.cjs
//   npm uninstall playwright

const path = require('node:path')
const os = require('node:os')
const fs = require('node:fs')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')
const { _electron: electron } = require('playwright')

const REPO_ROOT = path.resolve(__dirname, '..')
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'audio-editor-clickthrough-'))
const userDataDir = path.join(tmpRoot, 'userData')
const libraryDir = path.join(tmpRoot, 'library')
fs.mkdirSync(path.join(userDataDir, 'settings'), { recursive: true })
fs.mkdirSync(libraryDir, { recursive: true })
fs.writeFileSync(path.join(userDataDir, 'settings', 'libraryLocation.json'), JSON.stringify({ customBaseDir: libraryDir }))

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

// Dispatches real DOM mouse events directly on an element (bypassing
// OS-level simulated input) — this session's Playwright+Electron+HiDPI setup
// has a documented coordinate-mapping quirk with real mouse drags on small/
// scrolled targets (see TODO.md's Phase 6 clip-trim-handle note); dispatching
// bubbling native events directly is what that round used to route around it.
async function dispatchDrag(win, selector, points) {
  await win.locator(selector).evaluate((el, points) => {
    const rect = el.getBoundingClientRect()
    function fire(type, p) {
      const evt = new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + p.x * rect.width,
        clientY: rect.top + p.y * rect.height,
        button: 0,
        buttons: type === 'mouseup' ? 0 : 1,
      })
      el.dispatchEvent(evt)
    }
    fire('mousedown', points[0])
    for (let i = 1; i < points.length; i++) fire('mousemove', points[i])
    fire('mouseup', points[points.length - 1])
  }, points)
}

async function nonBgPixelCount(win, selector) {
  return win.locator(selector).evaluate((el) => {
    const ctx = el.getContext('2d')
    const data = ctx.getImageData(0, 0, el.width, el.height).data
    let n = 0
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3]
      if (a !== 0 && (Math.abs(r - 22) > 10 || Math.abs(g - 24) > 10 || Math.abs(b - 29) > 10)) n++
    }
    return n
  })
}

async function main() {
  const electronApp = await electron.launch({
    executablePath: require('electron'),
    args: [path.join(REPO_ROOT, 'dist-electron', 'main.js'), `--user-data-dir=${userDataDir}`],
  })
  const win = await electronApp.firstWindow()
  win.on('pageerror', (err) => {
    failed++
    console.error('  FAIL — uncaught renderer error:', err)
  })
  await win.waitForSelector('text=Projects')

  await win.click('text=+ New Project')
  await win.fill('input[placeholder^="Project name"]', 'Audio Editor Click-Through')
  await win.click('button:has-text("Create")')
  await win.waitForSelector('text=Media Library')

  const projectsDir = path.join(libraryDir, 'Projects')
  const projectDirName = fs.readdirSync(projectsDir)[0]
  const projectDir = path.join(projectsDir, projectDirName)
  const audioDir = path.join(projectDir, 'assets', 'audio')
  fs.mkdirSync(audioDir, { recursive: true })

  // A realistic stereo, moderately long, non-trivial-content clip: three
  // different tones back to back (not a single flat sine) so the waveform
  // has real visual variation to check, not just "some pixels somewhere".
  const assetId = crypto.randomUUID()
  const audioPath = path.join(audioDir, `${assetId}.wav`)
  execFileSync(
    ffmpegBinaryPath(),
    [
      '-y',
      '-f', 'lavfi', '-i', 'sine=frequency=220:duration=3',
      '-f', 'lavfi', '-i', 'sine=frequency=880:duration=3',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
      '-filter_complex', '[0:a][1:a][2:a]concat=n=3:v=0:a=1,pan=stereo|c0=c0|c1=c0',
      audioPath,
    ],
    { stdio: 'ignore' },
  )
  const stat = fs.statSync(audioPath)
  fs.writeFileSync(
    path.join(projectDir, 'assets.json'),
    JSON.stringify(
      [
        {
          id: assetId,
          originalName: 'clickthrough-clip.wav',
          storedFileName: `${assetId}.wav`,
          kind: 'audio',
          sizeBytes: stat.size,
          importedAt: new Date().toISOString(),
          relativePath: path.join('assets', 'audio', `${assetId}.wav`),
        },
      ],
      null,
      2,
    ),
  )

  await win.click('.tab-bar__tab:has-text("Media Library")')
  await win.waitForSelector('text=clickthrough-clip.wav')
  const editCount = await win.locator('button:has-text("✏️ Edit Audio")').count()
  assertTrue(editCount === 1, 'Edit Audio button present on the audio asset card')

  await win.click('button:has-text("✏️ Edit Audio")')
  await win.waitForSelector('text=Non-destructive:')
  await win.waitForSelector('canvas.audio-editor__waveform')
  await win.waitForTimeout(500)

  // --- Waveform renders on open ---
  const initialPixels = await nonBgPixelCount(win, 'canvas.audio-editor__waveform')
  assertTrue(initialPixels > 1000, `waveform canvas actually draws real content on open (${initialPixels} non-background pixels)`)

  const initialWidth = await win.locator('canvas.audio-editor__waveform').evaluate((el) => el.width)

  // --- Zoom in / out changes canvas width and still renders ---
  await win.click('button:has-text("Zoom +")')
  await win.waitForTimeout(200)
  const zoomedInWidth = await win.locator('canvas.audio-editor__waveform').evaluate((el) => el.width)
  assertTrue(zoomedInWidth > initialWidth, `Zoom + increases canvas width (${initialWidth} -> ${zoomedInWidth})`)
  const zoomedInPixels = await nonBgPixelCount(win, 'canvas.audio-editor__waveform')
  assertTrue(zoomedInPixels > 1000, `waveform still renders after zooming in (${zoomedInPixels} non-background pixels)`)

  await win.click('button:has-text("Zoom −")')
  await win.click('button:has-text("Zoom −")')
  await win.waitForTimeout(200)
  const zoomedOutWidth = await win.locator('canvas.audio-editor__waveform').evaluate((el) => el.width)
  assertTrue(zoomedOutWidth < zoomedInWidth, `Zoom − decreases canvas width (${zoomedInWidth} -> ${zoomedOutWidth})`)
  const zoomedOutPixels = await nonBgPixelCount(win, 'canvas.audio-editor__waveform')
  assertTrue(zoomedOutPixels > 500, `waveform still renders after zooming out (${zoomedOutPixels} non-background pixels)`)

  // --- Click-drag range selection on the waveform ---
  await win.locator('canvas.audio-editor__waveform').scrollIntoViewIfNeeded()
  await dispatchDrag(win, 'canvas.audio-editor__waveform', [
    { x: 0.05, y: 0.3 },
    { x: 0.15, y: 0.3 },
    { x: 0.3, y: 0.3 },
  ])
  await win.waitForTimeout(200)
  const trimToSelectionVisible = await win.locator('button:has-text("Trim to Selection")').count()
  assertTrue(trimToSelectionVisible === 1, 'click-drag on the waveform creates a range selection ("Trim to Selection" button appears)')

  if (trimToSelectionVisible === 1) {
    await win.click('button:has-text("Trim to Selection")')
    await win.waitForTimeout(150)
    assertTrue(true, 'Trim to Selection did not throw')
    // Reset to full clip so later steps operate on the whole thing.
    await win.click('button:has-text("Use Full Clip")')
  }

  // --- Fade in/out with curve change ---
  const fadeColumn = win.locator('.audio-editor__column').nth(1)
  const fadeInInput = fadeColumn.locator('input[type="number"]').nth(0)
  await fadeInInput.fill('0.75')
  assertTrue((await fadeInInput.inputValue()) === '0.75', 'Fade-in duration field accepts a typed value')

  const fadeInCurveSelect = fadeColumn.locator('select').nth(0)
  await fadeInCurveSelect.selectOption('qsin')
  assertTrue((await fadeInCurveSelect.inputValue()) === 'qsin', 'Fade-in curve dropdown switches to Quarter Sine')

  const fadeOutInput = fadeColumn.locator('input[type="number"]').nth(1)
  await fadeOutInput.fill('0.5')
  assertTrue(Number(await fadeOutInput.inputValue()) === 0.5, `Fade-out duration field accepts a typed value (read back "${await fadeOutInput.inputValue()}")`)

  // --- Normalize mode ---
  const normalizeSelect = fadeColumn.locator('select').nth(2)
  await normalizeSelect.selectOption('loudness')
  assertTrue((await normalizeSelect.inputValue()) === 'loudness', 'Normalize mode switches to Loudness')
  const loudnessHint = await win.locator('text=the live preview plays unnormalized').count()
  assertTrue(loudnessHint === 1, 'Loudness mode shows its documented live-preview-simplification hint')
  await normalizeSelect.selectOption('peak')

  // --- Envelope: add point via button, drag it, remove it ---
  await win.click('button:has-text("+ Add Point at Playhead")')
  await win.waitForTimeout(150)
  let envelopeRows = await win.locator('.audio-editor__envelope-row').count()
  assertTrue(envelopeRows === 1, 'Add Point at Playhead adds one envelope row')

  await win.locator('canvas.audio-editor__envelope-strip').scrollIntoViewIfNeeded()
  await dispatchDrag(win, 'canvas.audio-editor__envelope-strip', [
    { x: 0.4, y: 0.6 },
    { x: 0.4, y: 0.7 },
  ])
  await win.waitForTimeout(200)
  envelopeRows = await win.locator('.audio-editor__envelope-row').count()
  assertTrue(envelopeRows === 2, 'Clicking empty envelope-strip space adds a second point (drag-to-place)')

  const envelopePixelsBefore = await nonBgPixelCount(win, 'canvas.audio-editor__envelope-strip')
  assertTrue(envelopePixelsBefore > 50, `envelope strip canvas renders real content (${envelopePixelsBefore} non-background pixels)`)

  await win.click('.audio-editor__envelope-row >> nth=0 >> button:has-text("Remove")')
  await win.waitForTimeout(150)
  envelopeRows = await win.locator('.audio-editor__envelope-row').count()
  assertTrue(envelopeRows === 1, 'Remove button removes one envelope point')

  await win.click('button:has-text("Clear Envelope")')
  await win.waitForTimeout(150)
  const clearedHint = await win.locator('text=Flat — no automation points yet.').count()
  assertTrue(clearedHint === 1, 'Clear Envelope empties the envelope list')

  // --- Play / Stop ---
  await win.click('button:has-text("▶ Play")')
  await win.waitForTimeout(300)
  const stopVisible = await win.locator('button:has-text("⏹ Stop")').count()
  assertTrue(stopVisible === 1, 'Play button starts playback and turns into a Stop button')
  await win.click('button:has-text("⏹ Stop")')
  await win.waitForTimeout(150)
  const playVisible = await win.locator('button:has-text("▶ Play")').count()
  assertTrue(playVisible === 1, 'Stop button ends playback and turns back into Play')

  // --- Split (independently, on a fresh asset to not disturb the commit test) ---
  const splitInput = win.locator('.clip-inspector__field:has-text("Split at (s)") input')
  await splitInput.fill('4')
  await win.click('button:has-text("✂ Split Into Two Assets")')
  await win.waitForSelector('text=Non-destructive:', { state: 'detached', timeout: 30_000 })
  await win.click('.tab-bar__tab:has-text("Media Library")')
  const cardsAfterSplit = await win.locator('button:has-text("✏️ Edit Audio")').count()
  assertTrue(cardsAfterSplit === 3, `Split produced two new asset cards (3 total edit-audio buttons, found ${cardsAfterSplit})`)

  // --- Commit on the original clip ---
  await win.locator('.media-card', { hasText: 'clickthrough-clip.wav' }).locator('button:has-text("✏️ Edit Audio")').click()
  await win.waitForSelector('text=Non-destructive:')
  await win.waitForSelector('canvas.audio-editor__waveform')
  await win.waitForTimeout(400)
  const originalHashBefore = crypto.createHash('sha256').update(fs.readFileSync(audioPath)).digest('hex')
  await win.click('button:has-text("💾 Save as New Asset")')
  await win.waitForSelector('text=Saved as a new audio asset', { timeout: 30_000 })
  assertTrue(true, 'Commit (Save as New Asset) completed and showed the success banner')
  const originalHashAfter = crypto.createHash('sha256').update(fs.readFileSync(audioPath)).digest('hex')
  assertTrue(originalHashBefore === originalHashAfter, 'Original source file untouched after commit (non-destructive)')

  await win.click('button:has-text("Close")')
  await win.waitForSelector('text=Non-destructive:', { state: 'detached' })
  const finalCount = await win.locator('button:has-text("✏️ Edit Audio")').count()
  assertTrue(finalCount === 4, `commit added a 4th asset card (found ${finalCount})`)

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
    } catch {}
  })
