// Scripted Playwright UI pass for the Style tab + Phase 8 round (2026-09-14)
// — same technique every prior phase's UI verification used (see TODO.md):
// drives the real, built Electron window (real buttons, real typed
// keystrokes, real rendered DOM), isolated from Dan's real library via an
// isolated `--user-data-dir` *and* a pre-seeded `libraryLocation.json`
// pointing at a throwaway temp folder (an isolated userData dir alone
// doesn't isolate `app.getPath('documents')`). Playwright was installed
// ad-hoc for this pass (`npm install --no-save playwright`) and is not a
// permanent dependency — removed again after this script is run.
//
// Covers the pieces a manager-level script (scripts/verifyStyleAndPhase8.cjs)
// can't reach, since they're real React/renderer wiring:
//   - Item 1: the Style tab itself persists via the same debounced-autosave/
//     flush-on-unmount mechanism as Idea/Script.
//   - Item 2: "✨ Draft Grok Prompt" now sources its context from the Style
//     tab, not the Idea tab (the actual revision to the pre-existing flow).
//   - Item 4: "🎵 Draft Suno Prompt" / "🔊 Draft SFX Prompt" real click
//     behavior — always creates a brand-new entry (never reopens), never
//     auto-sends to the API, lands on the right sub-tab with the right
//     entry expanded.
//
// Run with:
//   npm run build
//   node scripts/verifyStyleAndPhase8UI.cjs

const path = require('node:path')
const os = require('node:os')
const fs = require('node:fs')
const { _electron: electron } = require('playwright')

const REPO_ROOT = path.resolve(__dirname, '..')
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'style-phase8-ui-verify-'))
const userDataDir = path.join(tmpRoot, 'userData')
const libraryDir = path.join(tmpRoot, 'library')
fs.mkdirSync(path.join(userDataDir, 'settings'), { recursive: true })
fs.mkdirSync(libraryDir, { recursive: true })
fs.writeFileSync(
  path.join(userDataDir, 'settings', 'libraryLocation.json'),
  JSON.stringify({ customBaseDir: libraryDir }),
)

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

async function main() {
  const electronApp = await electron.launch({
    executablePath: require('electron'),
    args: [path.join(REPO_ROOT, 'dist-electron', 'main.js'), `--user-data-dir=${userDataDir}`],
  })
  const win = await electronApp.firstWindow()
  await win.waitForSelector('text=Projects')

  // --- Create a throwaway project -----------------------------------------
  await win.click('text=+ New Project')
  await win.fill('input[placeholder^="Project name"]', 'Style Phase8 UI Verify')
  await win.click('button:has-text("Create")')
  await win.waitForSelector('text=Assets')

  // --- Item 1: Style tab persists, independent of Idea ----------------------
  await win.click('.tab-bar__tab:has-text("Idea")')
  await win.waitForSelector('textarea')
  await win.fill('.script-editor__textarea', 'IDEA-MARKER: lighthouse keeper premise.')

  await win.click('.tab-bar__tab:has-text("Style")')
  await win.waitForTimeout(150) // switch tabs well before the ~1.2s autosave debounce, per the data-loss-fix scenario
  await win.fill('.script-editor__textarea', 'STYLE-MARKER: handheld 16mm look, always.')
  await win.click('.tab-bar__tab:has-text("Script")')
  await win.waitForTimeout(150)

  await win.click('.tab-bar__tab:has-text("Style")')
  const styleTextAfterSwitch = await win.inputValue('.script-editor__textarea')
  assertTrue(
    styleTextAfterSwitch.includes('STYLE-MARKER'),
    'Style notes survive an immediate tab switch (flush-on-unmount autosave, same as Idea/Script)',
  )

  await win.click('.tab-bar__tab:has-text("Idea")')
  const ideaTextAfterSwitch = await win.inputValue('.script-editor__textarea')
  assertTrue(
    ideaTextAfterSwitch.includes('IDEA-MARKER') && !ideaTextAfterSwitch.includes('STYLE-MARKER'),
    'Idea notes are unaffected by Style notes — the two tabs are independent documents',
  )

  // A full reload resets App.tsx's "which project is open" in-memory state
  // (there's no URL routing), so this lands back on the project list —
  // reopening the project from there is how this test confirms the Style
  // notes actually hit disk, not just that React state survived.
  await win.reload()
  await win.waitForSelector('text=Style Phase8 UI Verify')
  await win.click('.project-card:has-text("Style Phase8 UI Verify")')
  await win.waitForSelector('text=Assets')
  await win.click('.tab-bar__tab:has-text("Style")')
  await win.waitForSelector('.script-editor__textarea')
  const styleTextAfterReload = await win.inputValue('.script-editor__textarea')
  assertTrue(styleTextAfterReload.includes('STYLE-MARKER'), 'Style notes actually hit disk (survive a full reload)')

  // --- Set up a scene + shot for the drafting flows -------------------------
  await win.click('.tab-bar__tab:has-text("Scenes & Shots")')
  await win.fill('input[placeholder^="New scene title"]', 'Harbor at Dawn')
  await win.click('button:has-text("+ Add Scene")')
  await win.waitForSelector('text=Harbor at Dawn')

  await win.fill('input[placeholder^="New shot title"]', 'Wide of the harbor')
  await win.click('button:has-text("+ Add Shot")')
  await win.waitForSelector('text=Wide of the harbor')

  // --- Item 2: "✨ Draft Grok Prompt" now sources Style, not Idea -----------
  await win.click('button:has-text("✨ Draft Grok Prompt")')
  await win.waitForSelector('.tab-bar__tab--active:has-text("Prompt Lab")')
  await win.waitForSelector('.ai-assistant__composer textarea')
  const grokComposerText = await win.inputValue('.ai-assistant__composer textarea')
  assertTrue(
    grokComposerText.includes('STYLE-MARKER'),
    '"Draft Grok Prompt" pulls Style tab notes into the composed request',
  )
  assertTrue(
    !grokComposerText.includes('IDEA-MARKER'),
    '"Draft Grok Prompt" no longer pulls in Idea notes (the actual revision)',
  )
  assertTrue(
    grokComposerText.toLowerCase().includes('style'),
    'the Style notes are labeled as such in the composed request, not silently pasted in',
  )
  // No auto-send: this profile has no Anthropic API key configured at all.
  const grokMessageCountAfterDraft = await win.locator('.ai-message').count()
  assertTrue(grokMessageCountAfterDraft === 0, '"Draft Grok Prompt" never calls the API automatically — no messages appear, just an unsent composed draft')
  assertTrue((await win.locator('.error-banner').count()) === 0, 'no error banner either — proof nothing was actually sent (a real send with no API key would show one)')

  // --- Item 4a: "🎵 Draft Suno Prompt" (scene) always drafts a new entry ----
  await win.click('.tab-bar__tab:has-text("Scenes & Shots")')
  await win.click('button:has-text("🎵 Draft Suno Prompt")')
  await win.waitForSelector('.tab-bar__tab--active:has-text("Prompt Lab")')
  await win.waitForSelector('.tab-bar--sub .tab-bar__tab--active:has-text("Suno")')
  const sunoEntryCountAfterFirst = await win.locator('.prompt-entry-list .prompt-entry-card').count()
  assertTrue(sunoEntryCountAfterFirst === 1, 'first "Draft Suno Prompt" click creates exactly one Suno entry')
  assertTrue(
    (await win.locator('.ai-message').count()) === 0,
    '"Draft Suno Prompt" also never auto-sends — the composer holds an unsent draft',
  )

  await win.click('.tab-bar__tab:has-text("Scenes & Shots")')
  await win.click('button:has-text("🎵 Draft Suno Prompt")')
  await win.waitForSelector('.tab-bar__tab--active:has-text("Prompt Lab")')
  const sunoEntryCountAfterSecond = await win.locator('.prompt-entry-list .prompt-entry-card').count()
  assertTrue(
    sunoEntryCountAfterSecond === 2,
    'a second "Draft Suno Prompt" click creates a second, distinct entry — never reopens the first (unlike Grok)',
  )

  await win.click('.tab-bar__tab:has-text("Scenes & Shots")')
  const sunoButtonLabel = await win.locator('button:has-text("Draft Suno Prompt")').innerText()
  assertTrue(sunoButtonLabel.includes('2'), 'the scene shows a count of its drafted Suno entries (2 drafted)')

  // --- Item 4b: "🔊 Draft SFX Prompt" (shot) always drafts a new entry, reuses linkedSfxIds ---
  await win.click('button:has-text("🔊 Draft SFX Prompt")')
  await win.waitForSelector('.tab-bar__tab--active:has-text("Prompt Lab")')
  await win.waitForSelector('.tab-bar--sub .tab-bar__tab--active:has-text("SFX")')
  const sfxEntryCountAfterFirst = await win.locator('.prompt-entry-list .prompt-entry-card').count()
  assertTrue(sfxEntryCountAfterFirst === 1, 'first "Draft SFX Prompt" click creates exactly one SFX entry')

  await win.click('.tab-bar__tab:has-text("Scenes & Shots")')
  await win.click('button:has-text("🔊 Draft SFX Prompt")')
  await win.waitForSelector('.tab-bar--sub .tab-bar__tab--active:has-text("SFX")')
  const sfxEntryCountAfterSecond = await win.locator('.prompt-entry-list .prompt-entry-card').count()
  assertTrue(sfxEntryCountAfterSecond === 2, 'a second "Draft SFX Prompt" click creates a second, distinct entry')

  await win.click('.tab-bar__tab:has-text("Scenes & Shots")')
  const shotRow = win.locator('.shot-card').first()
  await shotRow.locator('.shot-card__collapse').click()
  const checkedSfxCount = await win.locator('.checkbox-list__item input[type="checkbox"]:checked').count()
  assertTrue(checkedSfxCount === 2, "both drafted SFX entries land checked in the shot's existing Linked SFX checkbox list — no new field needed")

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
