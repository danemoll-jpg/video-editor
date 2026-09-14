import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import path from 'node:path'
import { ProjectManager } from './projectManager'
import { ProductionManager, type GeneratedSceneOutline } from './productionManager'
import { PromptLabManager, type PromptEntryInput, type PromptEntryUpdates, type RatingInput, type RatingUpdates } from './promptLabManager'
import {
  SfxLibraryManager,
  type SfxEntryInput,
  type SfxEntryUpdates,
  type SfxRatingInput,
  type SfxRatingUpdates,
} from './sfxLibraryManager'
import { SettingsManager } from './settingsManager'
import { AiAssistantManager, type AiAssistantContext } from './aiAssistantManager'
import { MediaLibraryManager } from './mediaLibraryManager'
import { registerMediaProtocolHandler } from './mediaProtocol'
import { EditorManager, type AddClipInput, type ClipUpdates } from './editorManager'
import { VideoExportManager } from './videoExportManager'
import { LibraryRelocationManager } from './libraryRelocationManager'
import type { ProjectSettings, TrackType } from './editorTypes'
import type { ShotStatus } from './shotStatus'
import type { PromptLabKind } from './promptLabTypes'

const isDev = !!process.env.VITE_DEV_SERVER_URL

let mainWindow: BrowserWindow | null = null
const projectManager = new ProjectManager()
const productionManager = new ProductionManager()
const promptLabManager = new PromptLabManager()
const sfxLibraryManager = new SfxLibraryManager()
const settingsManager = new SettingsManager()
const aiAssistantManager = new AiAssistantManager(settingsManager)
const mediaLibraryManager = new MediaLibraryManager(
  projectManager,
  productionManager,
  promptLabManager,
  sfxLibraryManager,
)
const editorManager = new EditorManager(projectManager)
// Reverse-proxy renders finish outside of any IPC call the renderer is
// awaiting (see editorManager.ts's "Reverse live-preview proxies" section) —
// this is how the renderer learns a pending → ready/error transition
// happened, so it knows to re-fetch the timeline (see preload.ts's
// onTimelineUpdated / EditorView.tsx).
editorManager.setChangeListener((projectId) => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('editor:timelineUpdated', projectId)
})
const videoExportManager = new VideoExportManager(projectManager, editorManager)
const libraryRelocationManager = new LibraryRelocationManager()

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: "Dan's Video Studio",
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  if (isDev) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL as string)
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(() => {
  registerMediaProtocolHandler()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// --- IPC: projects ------------------------------------------------------

ipcMain.handle('projects:list', () => projectManager.listProjects())
ipcMain.handle('projects:create', (_e, name: string) => projectManager.createProject(name))
ipcMain.handle('projects:get', (_e, id: string) => projectManager.getProject(id))
ipcMain.handle('projects:delete', (_e, id: string) => projectManager.deleteProject(id))
ipcMain.handle('projects:openFolder', (_e, id: string) => projectManager.openProjectFolder(id))

// --- IPC: assets ----------------------------------------------------------

ipcMain.handle('assets:list', (_e, projectId: string) => projectManager.listAssets(projectId))

ipcMain.handle('assets:import', async (_e, projectId: string) => {
  if (!mainWindow) return []
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Import assets',
    properties: ['openFile', 'multiSelections'],
  })
  if (result.canceled || result.filePaths.length === 0) return projectManager.listAssets(projectId)
  return projectManager.importAssets(projectId, result.filePaths)
})

ipcMain.handle('assets:delete', (_e, projectId: string, assetId: string) =>
  projectManager.deleteAsset(projectId, assetId),
)

ipcMain.handle('assets:extractAudio', (_e, projectId: string, assetId: string) =>
  projectManager.extractAudioAsset(projectId, assetId),
)

// --- IPC: idea ------------------------------------------------------------

ipcMain.handle('idea:get', (_e, projectId: string) => productionManager.getIdea(projectId))
ipcMain.handle('idea:save', (_e, projectId: string, content: string) =>
  productionManager.saveIdea(projectId, content),
)

// --- IPC: script ------------------------------------------------------

ipcMain.handle('script:get', (_e, projectId: string) => productionManager.getScript(projectId))
ipcMain.handle('script:save', (_e, projectId: string, content: string) =>
  productionManager.saveScript(projectId, content),
)

// --- IPC: scenes --------------------------------------------------------

ipcMain.handle('scenes:list', (_e, projectId: string) => productionManager.listScenes(projectId))

ipcMain.handle('scenes:create', (_e, projectId: string, title: string, description?: string) =>
  productionManager.createScene(projectId, title, description),
)

ipcMain.handle(
  'scenes:update',
  (
    _e,
    projectId: string,
    sceneId: string,
    updates: { title?: string; description?: string; linkedSongAssetIds?: string[] },
  ) => productionManager.updateScene(projectId, sceneId, updates),
)

ipcMain.handle('scenes:delete', (_e, projectId: string, sceneId: string) =>
  productionManager.deleteScene(projectId, sceneId),
)

ipcMain.handle('scenes:move', (_e, projectId: string, sceneId: string, direction: 'up' | 'down') =>
  productionManager.moveScene(projectId, sceneId, direction),
)

// --- IPC: shots -----------------------------------------------------------

ipcMain.handle('shots:list', (_e, projectId: string, sceneId?: string) =>
  productionManager.listShots(projectId, sceneId),
)

ipcMain.handle(
  'shots:create',
  (_e, projectId: string, sceneId: string, title: string, description?: string) =>
    productionManager.createShot(projectId, sceneId, title, description),
)

ipcMain.handle(
  'shots:update',
  (
    _e,
    projectId: string,
    shotId: string,
    updates: {
      title?: string
      description?: string
      promptText?: string
      status?: ShotStatus
      linkedAssetId?: string | null
      linkedSfxIds?: string[]
      linkedGrokEntryId?: string | null
    },
  ) => productionManager.updateShot(projectId, shotId, updates),
)

ipcMain.handle('shots:delete', (_e, projectId: string, shotId: string) =>
  productionManager.deleteShot(projectId, shotId),
)

ipcMain.handle('shots:move', (_e, projectId: string, shotId: string, direction: 'up' | 'down') =>
  productionManager.moveShot(projectId, shotId, direction),
)

// --- IPC: prompt labs (Grok / Suno / ElevenLabs) ---------------------------

ipcMain.handle('promptlab:list', (_e, projectId: string, kind: PromptLabKind) =>
  promptLabManager.listEntries(projectId, kind),
)

ipcMain.handle('promptlab:create', (_e, projectId: string, kind: PromptLabKind, input: PromptEntryInput) =>
  promptLabManager.createEntry(projectId, kind, input),
)

ipcMain.handle(
  'promptlab:update',
  (_e, projectId: string, kind: PromptLabKind, entryId: string, updates: PromptEntryUpdates) =>
    promptLabManager.updateEntry(projectId, kind, entryId, updates),
)

ipcMain.handle('promptlab:delete', (_e, projectId: string, kind: PromptLabKind, entryId: string) =>
  promptLabManager.deleteEntry(projectId, kind, entryId),
)

ipcMain.handle(
  'promptlab:rating:add',
  (_e, projectId: string, kind: PromptLabKind, entryId: string, input: RatingInput) =>
    promptLabManager.addRating(projectId, kind, entryId, input),
)

ipcMain.handle(
  'promptlab:rating:update',
  (_e, projectId: string, kind: PromptLabKind, entryId: string, ratingId: string, updates: RatingUpdates) =>
    promptLabManager.updateRating(projectId, kind, entryId, ratingId, updates),
)

ipcMain.handle(
  'promptlab:rating:delete',
  (_e, projectId: string, kind: PromptLabKind, entryId: string, ratingId: string) =>
    promptLabManager.deleteRating(projectId, kind, entryId, ratingId),
)

ipcMain.handle('promptlab:recipe:list', (_e, projectId: string, kind: PromptLabKind) =>
  promptLabManager.listRecipes(projectId, kind),
)

ipcMain.handle(
  'promptlab:recipe:promote',
  (_e, projectId: string, kind: PromptLabKind, entryId: string, name: string) =>
    promptLabManager.promoteToRecipe(projectId, kind, entryId, name),
)

ipcMain.handle(
  'promptlab:recipe:update',
  (
    _e,
    projectId: string,
    kind: PromptLabKind,
    recipeId: string,
    updates: { name?: string; promptText?: string; lyrics?: string; settings?: string; notes?: string; tags?: string[] },
  ) => promptLabManager.updateRecipe(projectId, kind, recipeId, updates),
)

ipcMain.handle('promptlab:recipe:delete', (_e, projectId: string, kind: PromptLabKind, recipeId: string) =>
  promptLabManager.deleteRecipe(projectId, kind, recipeId),
)

// --- IPC: SFX (unified library + ElevenLabs, Phase 5 merge) ---------------

ipcMain.handle('sfx:list', (_e, projectId: string) => sfxLibraryManager.listEntries(projectId))

ipcMain.handle('sfx:create', (_e, projectId: string, input: SfxEntryInput) =>
  sfxLibraryManager.createEntry(projectId, input),
)

ipcMain.handle('sfx:update', (_e, projectId: string, sfxId: string, updates: SfxEntryUpdates) =>
  sfxLibraryManager.updateEntry(projectId, sfxId, updates),
)

ipcMain.handle('sfx:delete', (_e, projectId: string, sfxId: string) =>
  sfxLibraryManager.deleteEntry(projectId, sfxId),
)

ipcMain.handle('sfx:rating:add', (_e, projectId: string, sfxId: string, input: SfxRatingInput) =>
  sfxLibraryManager.addRating(projectId, sfxId, input),
)

ipcMain.handle(
  'sfx:rating:update',
  (_e, projectId: string, sfxId: string, ratingId: string, updates: SfxRatingUpdates) =>
    sfxLibraryManager.updateRating(projectId, sfxId, ratingId, updates),
)

ipcMain.handle('sfx:rating:delete', (_e, projectId: string, sfxId: string, ratingId: string) =>
  sfxLibraryManager.deleteRating(projectId, sfxId, ratingId),
)

ipcMain.handle('sfx:recipe:list', (_e, projectId: string) => sfxLibraryManager.listRecipes(projectId))

ipcMain.handle('sfx:recipe:promote', (_e, projectId: string, sfxId: string, name: string) =>
  sfxLibraryManager.promoteToRecipe(projectId, sfxId, name),
)

ipcMain.handle(
  'sfx:recipe:update',
  (
    _e,
    projectId: string,
    recipeId: string,
    updates: { name?: string; promptText?: string; settings?: string; notes?: string; tags?: string[] },
  ) => sfxLibraryManager.updateRecipe(projectId, recipeId, updates),
)

ipcMain.handle('sfx:recipe:delete', (_e, projectId: string, recipeId: string) =>
  sfxLibraryManager.deleteRecipe(projectId, recipeId),
)

// --- IPC: settings (Phase 4 — Anthropic API key) ---------------------------
//
// `hasApiKey` only reports whether a key is set — the decrypted key itself
// never crosses this bridge; only aiAssistantManager.ts (main process) reads
// it, to call the Anthropic API.

ipcMain.handle('settings:hasApiKey', () => settingsManager.hasApiKey())
ipcMain.handle('settings:setApiKey', (_e, key: string) => settingsManager.setApiKey(key))
ipcMain.handle('settings:clearApiKey', () => settingsManager.clearApiKey())

// --- IPC: AI Assistant (Phase 4) -------------------------------------------

ipcMain.handle('ai:list', (_e, projectId: string, context: AiAssistantContext) =>
  aiAssistantManager.listMessages(projectId, context),
)
ipcMain.handle('ai:send', (_e, projectId: string, context: AiAssistantContext, text: string) =>
  aiAssistantManager.sendMessage(projectId, context, text),
)
ipcMain.handle('ai:getDraft', (_e, projectId: string, context: AiAssistantContext) =>
  aiAssistantManager.getDraft(projectId, context),
)
ipcMain.handle('ai:saveDraft', (_e, projectId: string, context: AiAssistantContext, text: string) =>
  aiAssistantManager.saveDraft(projectId, context, text),
)

// "Generate Scenes & Shots" (Script tab, 2026-09-14): the AI call and the
// scene/shot creation are two separate manager calls, wired together here —
// aiAssistantManager only talks to Anthropic and parses the result;
// productionManager owns actually writing scenes/shots (including the
// add-vs-replace choice and the pre-replace backup).
ipcMain.handle('ai:generateSceneOutline', (_e, projectId: string, scriptText: string) =>
  aiAssistantManager.generateSceneOutline(projectId, scriptText),
)
ipcMain.handle(
  'scenes:applyGenerated',
  (_e, projectId: string, generated: GeneratedSceneOutline[], mode: 'add' | 'replace') =>
    productionManager.applyGeneratedOutline(projectId, generated, mode),
)

// --- IPC: Media Library (Phase 5) -------------------------------------------

ipcMain.handle('media:getLibrary', (_e, projectId: string) => mediaLibraryManager.getLibrary(projectId))
ipcMain.handle('media:listExports', (_e, projectId: string) => mediaLibraryManager.listExports(projectId))

// --- IPC: Video Editor (Phase 6) --------------------------------------------

ipcMain.handle('editor:getTimeline', (_e, projectId: string) => editorManager.getTimeline(projectId))

ipcMain.handle('editor:updateProjectSettings', (_e, projectId: string, updates: Partial<ProjectSettings>) =>
  editorManager.updateProjectSettings(projectId, updates),
)

ipcMain.handle('editor:track:add', (_e, projectId: string, type: TrackType, name?: string) =>
  editorManager.addTrack(projectId, type, name),
)
ipcMain.handle(
  'editor:track:update',
  (_e, projectId: string, trackId: string, updates: { name?: string; muted?: boolean; hidden?: boolean }) =>
    editorManager.updateTrack(projectId, trackId, updates),
)
ipcMain.handle('editor:track:delete', (_e, projectId: string, trackId: string) =>
  editorManager.deleteTrack(projectId, trackId),
)
ipcMain.handle('editor:track:reorder', (_e, projectId: string, type: TrackType, orderedTrackIds: string[]) =>
  editorManager.reorderTracks(projectId, type, orderedTrackIds),
)

ipcMain.handle('editor:clip:add', (_e, projectId: string, input: AddClipInput) => editorManager.addClip(projectId, input))
ipcMain.handle('editor:clip:update', (_e, projectId: string, clipId: string, updates: ClipUpdates) =>
  editorManager.updateClip(projectId, clipId, updates),
)
ipcMain.handle('editor:clip:delete', (_e, projectId: string, clipId: string) =>
  editorManager.deleteClip(projectId, clipId),
)
ipcMain.handle('editor:clip:split', (_e, projectId: string, clipId: string, atTime: number) =>
  editorManager.splitClip(projectId, clipId, atTime),
)
ipcMain.handle('editor:clip:duplicate', (_e, projectId: string, clipId: string) =>
  editorManager.duplicateClip(projectId, clipId),
)
ipcMain.handle('editor:clip:extractAudio', (_e, projectId: string, clipId: string) =>
  editorManager.extractClipAudio(projectId, clipId),
)

ipcMain.handle('editor:getAssetMediaUrl', (_e, projectId: string, assetId: string) =>
  editorManager.getAssetMediaUrl(projectId, assetId),
)
ipcMain.handle('editor:getReverseProxyUrl', (_e, projectId: string, clipId: string) =>
  editorManager.getReverseProxyMediaUrl(projectId, clipId),
)

ipcMain.handle('editor:chooseExportDestination', async () => {
  if (!mainWindow) return null
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose an export destination',
    properties: ['openDirectory', 'createDirectory'],
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
})

ipcMain.handle('editor:export', async (event, projectId: string, outputName: string, destinationDir?: string) => {
  const sender = event.sender
  return videoExportManager.exportMp4(
    projectId,
    outputName,
    (progress) => {
      if (!sender.isDestroyed()) sender.send('editor:exportProgress', progress)
    },
    destinationDir,
  )
})

// --- IPC: Library location (Settings) ---------------------------------------

ipcMain.handle('library:getLocation', () => libraryRelocationManager.getCurrentLocation())

ipcMain.handle('library:relocate', async () => {
  if (!mainWindow) return null
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Choose a new location for Dan's Video Studio's library",
    properties: ['openDirectory', 'createDirectory'],
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return libraryRelocationManager.relocateLibrary(result.filePaths[0])
})
