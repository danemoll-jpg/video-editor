import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import path from 'node:path'
import { ProjectManager } from './projectManager'
import { ProductionManager } from './productionManager'
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

// --- IPC: Media Library (Phase 5) -------------------------------------------

ipcMain.handle('media:getLibrary', (_e, projectId: string) => mediaLibraryManager.getLibrary(projectId))
ipcMain.handle('media:listExports', (_e, projectId: string) => mediaLibraryManager.listExports(projectId))
