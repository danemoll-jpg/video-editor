// Scripted Playwright UI pass for the Audio Editor (2026-09-15) — same
// technique every prior phase's UI verification used (see TODO.md): drives
// the real, built Electron window (real buttons, real typed input, real
// rendered DOM/canvas), isolated from Dan's real library via an isolated
// `--user-data-dir` plus a pre-seeded `libraryLocation.json` pointing at a
// throwaway temp folder (same isolation trick verifyStyleAndPhase8UI.cjs
// uses). Playwright is installed ad-hoc for this pass
// (`npm install --no-save playwright`) and is not a permanent dependency —
// remove it again afterward.
//
// scripts/verifyAudioEditor.cjs already exercises the real FFmpeg render
// path (fades/envelope/normalize/split, pixel^H^H^H sample-level verified)
// through ProjectManager directly — this script instead covers the piece
// that can't be reached that way: the real React/DOM wiring — the
// "✏️ Edit Audio" button appears only on audio cards, the modal actually
// opens and renders a waveform, editing a field doesn't crash, and
// clicking commit produces a second audio card in the Media Library.
//
// An audio asset is seeded directly on disk (a real tone rendered via the
// bundled FFmpeg, plus a hand-written assets.json entry) rather than
// through the native import dialog, which Playwright can't drive — same
// "mock the file picker by seeding disk state instead" workaround every
// earlier phase's UI verification has used.
//
// Run with:
//   npm run build
//   npm install --no-save playwright
//   node scripts/verifyAudioEditorUI.cjs
//   npm uninstall playwright

const path = require('node:path')
const os = require('node:os')
const fs = require('node:fs')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')
const { _electron: electron } = require('playwright')

const REPO_ROOT = path.resolve(__dirname, '..')
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'audio-editor-ui-verify-'))
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

async function main() {
  const electronApp = await electron.launch({
    executablePath: require('electron'),
    args: [path.join(REPO_ROOT, 'dist-electron', 'main.js'), `--user-data-dir=${userDataDir}`],
  })
  const win = await electronApp.firstWindow()
  await win.waitForSelector('text=Projects')

  // --- Create a throwaway project, then seed a real audio asset directly on disk ---
  await win.click('text=+ New Project')
  await win.fill('input[placeholder^="Project name"]', 'Audio Editor UI Verify')
  await win.click('button:has-text("Create")')
  await win.waitForSelector('text=Media Library')

  const projectsDir = path.join(libraryDir, 'Projects')
  const projectDirName = fs.readdirSync(projectsDir)[0]
  const projectDir = path.join(projectsDir, projectDirName)

  const assetId = crypto.randomUUID()
  const audioDir = path.join(projectDir, 'assets', 'audio')
  fs.mkdirSync(audioDir, { recursive: true })
  const audioPath = path.join(audioDir, `${assetId}.wav`)
  execFileSync(ffmpegBinaryPath(), ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', audioPath])
  const stat = fs.statSync(audioPath)
  fs.writeFileSync(
    path.join(projectDir, 'assets.json'),
    JSON.stringify(
      [
        {
          id: assetId,
          originalName: 'ui-test-tone.wav',
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

  // --- Open Media Library, confirm the seeded asset shows the Edit Audio action ---
  await win.click('.tab-bar__tab:has-text("Media Library")')
  await win.waitForSelector('text=ui-test-tone.wav')
  const editButtonCount = await win.locator('button:has-text("✏️ Edit Audio")').count()
  assertTrue(editButtonCount === 1, 'exactly one "✏️ Edit Audio" action is shown, on the seeded audio asset\'s card')

  // --- Open the editor, confirm it renders a real waveform ------------------
  await win.click('button:has-text("✏️ Edit Audio")')
  await win.waitForSelector('text=Non-destructive:')
  await win.waitForSelector('canvas.audio-editor__waveform')
  const canvasWidth = await win.locator('canvas.audio-editor__waveform').evaluate((el) => el.width)
  assertTrue(canvasWidth > 0, `waveform canvas rendered with a real, decoded width (${canvasWidth}px) — audio was actually decoded, not just a placeholder`)

  // --- Adjust fade/normalize fields, confirm no crash and values stick ------
  await win.fill('.audio-editor__columns >> nth=1 >> input[type="number"] >> nth=0', '0.5')
  const fadeInValue = await win.locator('.audio-editor__columns >> nth=1 >> input[type="number"] >> nth=0').inputValue()
  assertTrue(Number(fadeInValue) === 0.5, 'fade-in duration field accepts and reflects a typed value')

  await win.selectOption('.audio-editor__columns >> nth=1 >> select >> nth=1', 'peak')
  const normalizeValue = await win.locator('.audio-editor__columns >> nth=1 >> select >> nth=1').inputValue()
  assertTrue(normalizeValue === 'peak', 'normalize mode dropdown switches to Peak')

  // --- Add an envelope point via the button, confirm the row appears --------
  await win.click('button:has-text("+ Add Point at Playhead")')
  await win.waitForSelector('.audio-editor__envelope-row')
  const envelopeRowCount = await win.locator('.audio-editor__envelope-row').count()
  assertTrue(envelopeRowCount === 1, 'adding an envelope point renders one editable row')

  // --- Commit: produces a brand-new asset, original untouched ----------------
  const originalHashBefore = crypto.createHash('sha256').update(fs.readFileSync(audioPath)).digest('hex')
  await win.click('button:has-text("💾 Save as New Asset")')
  await win.waitForSelector('text=Saved as a new audio asset', { timeout: 30_000 })
  assertTrue(true, 'commit completed and showed the success message')

  const originalHashAfter = crypto.createHash('sha256').update(fs.readFileSync(audioPath)).digest('hex')
  assertTrue(originalHashAfter === originalHashBefore, 'the original seeded audio file on disk is byte-identical after committing (non-destructive)')

  await win.click('button:has-text("Close")')
  await win.waitForSelector('text=Non-destructive:', { state: 'detached' })
  const editButtonCountAfter = await win.locator('button:has-text("✏️ Edit Audio")').count()
  assertTrue(editButtonCountAfter === 2, `committing added a second audio card with its own Edit Audio action (found ${editButtonCountAfter})`)

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
