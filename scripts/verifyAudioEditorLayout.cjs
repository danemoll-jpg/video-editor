// Scripted Playwright UI pass targeting the 2026-09-15 "no visible waveform
// box" bug report — distinct from verifyAudioEditorUI.cjs, which only ever
// checked canvas.width (the drawing-surface/pixel-content dimension, set by
// the width/height DOM attributes) and therefore could not have caught a
// pure CSS/layout sizing bug. This script checks getBoundingClientRect()
// on the waveform and envelope canvases instead — their real on-screen
// rendered box — against a real, long (230s, matching Dan's actual file)
// audio asset, since the report was that the reproduction needed both a
// long real file and (as this script demonstrates) a realistic window size.
//
// Same isolated --user-data-dir / seeded libraryLocation.json technique as
// verifyAudioEditorUI.cjs. Playwright is installed ad-hoc
// (`npm install --no-save playwright`) and removed again afterward.
//
// Run with:
//   npm run build
//   npm install --no-save playwright
//   node scripts/verifyAudioEditorLayout.cjs
//   npm uninstall playwright

const path = require('node:path')
const os = require('node:os')
const fs = require('node:fs')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')
const { _electron: electron } = require('playwright')

const REPO_ROOT = path.resolve(__dirname, '..')
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'audio-editor-layout-verify-'))
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

  // Match Dan's real report as closely as this harness can: a realistic
  // window size (main.ts's own default is 1280x800 — not an artificially
  // huge Playwright viewport that would hide a shrink-driven collapse).
  await electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setSize(1280, 800)
  })

  // --- Create a throwaway project, then seed a real, LONG audio asset -------
  await win.click('text=+ New Project')
  await win.fill('input[placeholder^="Project name"]', 'Audio Editor Layout Verify')
  await win.click('button:has-text("Create")')
  await win.waitForSelector('text=Media Library')

  const projectsDir = path.join(libraryDir, 'Projects')
  const projectDirName = fs.readdirSync(projectsDir)[0]
  const projectDir = path.join(projectsDir, projectDirName)

  const assetId = crypto.randomUUID()
  const audioDir = path.join(projectDir, 'assets', 'audio')
  fs.mkdirSync(audioDir, { recursive: true })
  const audioPath = path.join(audioDir, `${assetId}.mp3`)
  // 230.16s to match Dan's real file's duration as closely as practical.
  execFileSync(ffmpegBinaryPath(), ['-y', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=230.16', audioPath])
  const stat = fs.statSync(audioPath)
  fs.writeFileSync(
    path.join(projectDir, 'assets.json'),
    JSON.stringify(
      [
        {
          id: assetId,
          originalName: '7 or 8 Hours, Give or Take.mp3',
          storedFileName: `${assetId}.mp3`,
          kind: 'audio',
          sizeBytes: stat.size,
          importedAt: new Date().toISOString(),
          relativePath: path.join('assets', 'audio', `${assetId}.mp3`),
        },
      ],
      null,
      2,
    ),
  )

  // --- Open Media Library, open the editor -----------------------------------
  await win.click('.tab-bar__tab:has-text("Media Library")')
  await win.waitForSelector('text=7 or 8 Hours, Give or Take.mp3')
  await win.click('button:has-text("✏️ Edit Audio")')
  await win.waitForSelector('text=Non-destructive:')
  await win.waitForSelector('canvas.audio-editor__waveform')
  // Let the decode + initial draw settle.
  await win.waitForTimeout(500)

  // --- The actual regression check: real ON-SCREEN box size, not pixel content ---
  const waveformRect = await win.locator('canvas.audio-editor__waveform').evaluate((el) => {
    const r = el.getBoundingClientRect()
    return { width: r.width, height: r.height }
  })
  const envelopeRect = await win.locator('canvas.audio-editor__envelope-strip').evaluate((el) => {
    const r = el.getBoundingClientRect()
    return { width: r.width, height: r.height }
  })
  const scrollRect = await win.locator('.audio-editor__scroll').evaluate((el) => {
    const r = el.getBoundingClientRect()
    return { width: r.width, height: r.height }
  })

  console.log(`  waveform canvas rendered rect: ${JSON.stringify(waveformRect)}`)
  console.log(`  envelope canvas rendered rect: ${JSON.stringify(envelopeRect)}`)
  console.log(`  .audio-editor__scroll rendered rect: ${JSON.stringify(scrollRect)}`)

  assertTrue(scrollRect.height > 100, `.audio-editor__scroll has a real on-screen height (${scrollRect.height}px), not collapsed to ~0`)
  assertTrue(waveformRect.height >= 100, `waveform canvas is actually visible on screen (rendered height ${waveformRect.height}px, expected 140px)`)
  assertTrue(envelopeRect.height >= 40, `envelope canvas is actually visible on screen (rendered height ${envelopeRect.height}px, expected 70px)`)
  assertTrue(waveformRect.width > 0, `waveform canvas has nonzero on-screen width (${waveformRect.width}px)`)

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
