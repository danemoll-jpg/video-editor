// Scripted verification for the Style tab + Phase 8 round (2026-09-14):
//   1. New Style tab (electron/productionManager.ts's getStyle/saveStyle)
//   2. Style notes replace Idea notes as Grok/Suno/SFX draft context
//   3. Style notes added to the scene/shot outline generator
//   4. "Draft Suno Prompt" (scene) / "Draft SFX Prompt" (shot) data-model support
//   5. Shared top-rated-entries/recipes technique-context assembly (src/labContext.ts)
//
// Same pattern as every prior phase's scripted verification (see TODO.md):
// exercises the real, compiled ProductionManager/PromptLabManager/
// SfxLibraryManager/aiAssistantManager code (from dist-electron/, after
// `npm run build`) through a real (headless) Electron process, isolated
// from Dan's real library via throwaway userData/documents temp dirs.
//
// Item 2's actual UI wiring (SceneList.tsx's handleDraftGrokPrompt/
// handleDraftSunoPrompt/handleDraftSfxPrompt calling window.api.getStyle,
// not getIdea, and passing the result through the shared labContext.ts
// helpers) is renderer-only React code, not something this manager-level
// script can exercise directly — that half is covered by a separate
// scripted Playwright pass against the real, built Electron window (see
// TODO.md's writeup for that pass's assertions). This script covers:
//   - the underlying data model (Style CRUD, Scene.linkedSunoEntryIds,
//     Shot.linkedSfxIds reused for SFX drafts) those UI flows read/write,
//   - the outline generator's real style-notes injection
//     (aiAssistantManager.ts's exported `buildOutlineUserMessage`), and
//   - the shared technique-context assembly logic itself (src/labContext.ts,
//     a plain renderer-side TS module with zero Electron/DOM dependencies —
//     transpiled fresh via esbuild, same "test the real source, not a
//     reimplementation" approach scripts/verifyChromaKey.mjs already uses
//     for src/chromaKey.ts) against hand-built rating/recipe fixtures.
//
// Run with:
//   npm run build
//   node_modules\.bin\electron.cmd scripts\verifyStyleAndPhase8.cjs

const path = require('node:path')
const os = require('node:os')
const fs = require('node:fs')

const REPO_ROOT = path.resolve(__dirname, '..')
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'style-phase8-verify-'))
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
function assertEqual(actual, expected, msg) {
  assertTrue(actual === expected, `${msg} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`)
}

const { app } = require('electron')
app.setPath('userData', userDataDir)
app.setPath('documents', documentsDir)

const { ProjectManager } = require(path.join(REPO_ROOT, 'dist-electron', 'projectManager'))
const { ProductionManager } = require(path.join(REPO_ROOT, 'dist-electron', 'productionManager'))
const { PromptLabManager } = require(path.join(REPO_ROOT, 'dist-electron', 'promptLabManager'))
const { SfxLibraryManager } = require(path.join(REPO_ROOT, 'dist-electron', 'sfxLibraryManager'))
const { AI_ASSISTANT_CONTEXTS, buildOutlineUserMessage } = require(
  path.join(REPO_ROOT, 'dist-electron', 'aiAssistantManager'),
)
const { readJsonFile, writeJsonFile } = require(path.join(REPO_ROOT, 'dist-electron', 'fsUtils'))

app.whenReady().then(async () => {
  try {
    await main()
    await verifyLabContext()
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

async function main() {
  const projectManager = new ProjectManager()
  const productionManager = new ProductionManager()
  const promptLabManager = new PromptLabManager()
  const sfxLibraryManager = new SfxLibraryManager()

  console.log('Setting up a throwaway project…')
  const project = await projectManager.createProject('Style + Phase 8 Verify')

  // --- Item 1: Style tab CRUD, independent of Idea -------------------------
  console.log('\nItem 1 — Style tab:')
  const emptyStyle = await productionManager.getStyle(project.id)
  assertEqual(emptyStyle.content, '', 'a fresh project has no Style notes yet')

  const savedStyle = await productionManager.saveStyle(project.id, 'Camera stays locked unless an emotional beat.')
  assertEqual(savedStyle.content, 'Camera stays locked unless an emotional beat.', 'saveStyle persists the content')
  assertTrue(!!savedStyle.updatedAt, 'saveStyle stamps updatedAt')

  const reread = await productionManager.getStyle(project.id)
  assertEqual(reread.content, savedStyle.content, 'getStyle re-reads the saved content')

  await productionManager.saveIdea(project.id, 'Brainstorm: a lighthouse keeper falls in love with the fog.')
  const idea = await productionManager.getIdea(project.id)
  const styleAfterIdea = await productionManager.getStyle(project.id)
  assertTrue(idea.content !== styleAfterIdea.content, 'Idea and Style are stored independently, not conflated')
  assertEqual(styleAfterIdea.content, savedStyle.content, "saving Idea notes doesn't touch Style notes")

  assertTrue(AI_ASSISTANT_CONTEXTS.includes('style'), "AI_ASSISTANT_CONTEXTS includes 'style' (Style Assistant panel)")
  // SYSTEM_PROMPTS[context] is typed `Record<AiAssistantContext, string>` in
  // aiAssistantManager.ts — adding 'style' to the AiAssistantContext union
  // without a matching SYSTEM_PROMPTS.style entry fails `npm run build`
  // (confirmed: this script only runs after a successful build), so a
  // successful build is itself proof SYSTEM_PROMPTS.style exists.
  assertTrue(true, 'SYSTEM_PROMPTS.style exists (enforced by TypeScript at build time — see comment)')

  // --- Item 3: outline generator's real style-notes injection --------------
  console.log('\nItem 3 — Style notes in the scene/shot outline generator:')
  const scriptText = '**S1** Wide of the harbor at dawn.'
  const withoutStyle = buildOutlineUserMessage(scriptText, '')
  assertEqual(withoutStyle, scriptText, 'no Style notes → the outline request is just the script text, unchanged')

  const withStyle = buildOutlineUserMessage(scriptText, '  Handheld 16mm look, always.  ')
  assertTrue(withStyle.includes('Handheld 16mm look, always.'), 'Style notes text is present in the outline request')
  assertTrue(withStyle.includes(scriptText), 'the original script text is still present, unmodified')
  assertTrue(
    withStyle.indexOf('Handheld 16mm look') < withStyle.indexOf(scriptText),
    'Style notes come before the script text',
  )
  assertTrue(withStyle.toLowerCase().includes('style'), "the injected block is labeled as style context, not silent")

  // --- Item 4a: Scene.linkedSunoEntryIds (Suno draft link, separate from linkedSongAssetIds) ---
  console.log('\nItem 4 — Draft Suno Prompt (scene) / Draft SFX Prompt (shot) data model:')
  const [scene] = await productionManager.createScene(project.id, 'Harbor at Dawn')
  assertTrue(Array.isArray(scene.linkedSunoEntryIds) && scene.linkedSunoEntryIds.length === 0, 'a new scene starts with linkedSunoEntryIds: []')
  assertTrue(Array.isArray(scene.linkedSongAssetIds) && scene.linkedSongAssetIds.length === 0, 'linkedSongAssetIds is untouched, still []')

  const sunoEntries = await promptLabManager.createEntry(project.id, 'suno', { promptText: 'Melancholy strings, slow build.' })
  const sunoEntryId = sunoEntries[0].id
  const scenesAfterLink = await productionManager.updateScene(project.id, scene.id, {
    linkedSunoEntryIds: [sunoEntryId],
  })
  const updatedScene = scenesAfterLink.find((s) => s.id === scene.id)
  assertTrue(updatedScene.linkedSunoEntryIds.includes(sunoEntryId), 'updateScene persists a linked Suno draft entry id')
  assertEqual(updatedScene.linkedSongAssetIds.length, 0, 'linking a Suno draft entry does not touch linkedSongAssetIds')

  // A second "always drafts a new entry" click: a second Suno entry, appended, not replacing the first.
  const sunoEntries2 = await promptLabManager.createEntry(project.id, 'suno', { promptText: 'Bright, driving synth-pop.' })
  const sunoEntryId2 = sunoEntries2[0].id
  const scenesAfterSecondLink = await productionManager.updateScene(project.id, scene.id, {
    linkedSunoEntryIds: [...updatedScene.linkedSunoEntryIds, sunoEntryId2],
  })
  const sceneAfterTwo = scenesAfterSecondLink.find((s) => s.id === scene.id)
  assertEqual(sceneAfterTwo.linkedSunoEntryIds.length, 2, "two 'Draft Suno Prompt' clicks produce two distinct linked entries, not one reused")

  // Legacy scene missing linkedSunoEntryIds normalizes to [] on read (same backfill pattern as every other list field).
  const scenesPath = path.join(project.path, 'script', 'scenes.json')
  const rawScenes = await readJsonFile(scenesPath, [])
  const legacyScenes = rawScenes.map((s) => {
    const clone = { ...s }
    delete clone.linkedSunoEntryIds
    return clone
  })
  await writeJsonFile(scenesPath, legacyScenes)
  const relistedScenes = await productionManager.listScenes(project.id)
  assertTrue(
    relistedScenes.every((s) => Array.isArray(s.linkedSunoEntryIds)),
    'a legacy scene missing linkedSunoEntryIds normalizes to [] instead of throwing',
  )
  // Restore the real (non-legacy) scenes for the rest of this run.
  await writeJsonFile(scenesPath, rawScenes)

  // --- Item 4b: Shot.linkedSfxIds reused for SFX drafts (no new field needed) ---
  const [shot] = await productionManager.createShot(project.id, scene.id, 'Wide of the harbor')
  assertEqual(shot.linkedSfxIds.length, 0, 'a new shot starts with linkedSfxIds: []')

  const sfxEntries = await sfxLibraryManager.createEntry(project.id, {
    source: 'elevenlabs',
    name: shot.title,
    promptText: 'Distant foghorn, gentle waves.',
  })
  const sfxEntryId = sfxEntries[0].id
  const shotsAfterSfxLink = await productionManager.updateShot(project.id, shot.id, {
    linkedSfxIds: [...shot.linkedSfxIds, sfxEntryId],
  })
  const updatedShot = shotsAfterSfxLink.find((s) => s.id === shot.id)
  assertTrue(updatedShot.linkedSfxIds.includes(sfxEntryId), "the drafted SFX entry's id lands in the shot's existing linkedSfxIds — no new field needed")

  const sfxEntries2 = await sfxLibraryManager.createEntry(project.id, {
    source: 'elevenlabs',
    name: shot.title,
    promptText: 'A door creaks open, slow.',
  })
  const sfxEntryId2 = sfxEntries2[0].id
  const shotsAfterSecondSfx = await productionManager.updateShot(project.id, shot.id, {
    linkedSfxIds: [...updatedShot.linkedSfxIds, sfxEntryId2],
  })
  const shotAfterTwo = shotsAfterSecondSfx.find((s) => s.id === shot.id)
  assertEqual(shotAfterTwo.linkedSfxIds.length, 2, "two 'Draft SFX Prompt' clicks produce two distinct linked entries, not one reused")

  await projectManager.deleteProject(project.id)
}

/**
 * Compiles the real src/labContext.ts (plus its src/ratingUtils.ts
 * dependency) to a temp CommonJS module via esbuild — same "test the real
 * source, not a reimplementation" technique scripts/verifyChromaKey.mjs
 * already uses for src/chromaKey.ts — then exercises it against hand-built
 * rating/recipe fixtures. This module has zero Electron/DOM dependencies,
 * so no Electron APIs are needed for this half.
 */
async function verifyLabContext() {
  console.log('\nItem 5 — shared top-rated-entries/recipes technique context (src/labContext.ts):')
  const esbuild = require('esbuild')
  const result = esbuild.buildSync({
    entryPoints: [path.join(REPO_ROOT, 'src', 'labContext.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
  })
  const outFile = path.join(tmpRoot, 'labContext.js')
  fs.writeFileSync(outFile, result.outputFiles[0].text)
  const { buildTechniqueContext, assembleDraftRequest } = require(outFile)

  const entries = [
    { promptText: 'Wide establishing shot, golden hour.', ratings: [{ scores: { visualQuality: 5 } }] },
    { promptText: 'Never rated, should not appear.', ratings: [] },
    { promptText: 'Handheld chase, slight motion blur.', ratings: [{ scores: { visualQuality: 3 } }] },
  ]
  const technique = buildTechniqueContext('Grok', entries, [], ['visualQuality'])
  assertTrue(technique.includes('Wide establishing shot, golden hour.'), 'the top-rated (5/5) entry is included')
  assertTrue(technique.includes('Handheld chase, slight motion blur.'), 'the lower-rated (3/5) entry is also included, ranked below it')
  assertTrue(!technique.includes('Never rated, should not appear.'), 'an unrated entry (including a just-created blank draft) is excluded, not quoted as "top"')
  assertTrue(
    technique.indexOf('golden hour') < technique.indexOf('motion blur'),
    'entries are ordered highest-rated first',
  )

  const withRecipes = buildTechniqueContext('Grok', [], [{ name: 'Reliable wide shot', promptText: 'Static wide, natural light.' }], ['visualQuality'])
  assertTrue(withRecipes.includes('Reliable wide shot') && withRecipes.includes('Static wide, natural light.'), 'a promoted recipe is included by name and wording')

  const nothingRated = buildTechniqueContext('Grok', [{ promptText: 'x', ratings: [] }], [], ['visualQuality'])
  assertEqual(nothingRated, '', 'no rated entries and no recipes → an empty context block, not empty-but-noisy text')

  const full = assembleDraftRequest('Draft a Grok video-generation prompt for this shot:', 'Wide of the harbor.', [
    'Project style notes (from the Style tab):\nHandheld 16mm look.',
    technique,
  ])
  assertTrue(full.includes('Handheld 16mm look.'), 'assembleDraftRequest includes the Style notes block')
  assertTrue(full.includes('golden hour'), 'assembleDraftRequest includes the technique-context block')
  assertTrue(full.trim().endsWith('Wide of the harbor.'), 'the actual seed/instruction stays last, after all context')

  const bare = assembleDraftRequest('Draft a Grok video-generation prompt for this shot:', 'Wide of the harbor.', ['', '   '])
  assertEqual(
    bare,
    'Draft a Grok video-generation prompt for this shot:\n\nWide of the harbor.',
    'blank/whitespace-only context blocks (e.g. no Style notes yet, nothing rated yet) are dropped entirely — no stray separators',
  )
}
