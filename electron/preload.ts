import { contextBridge, ipcRenderer } from 'electron'
import type { Asset, ProjectSummary } from './projectManager'
import type { GeneratedSceneOutline, Idea, Scene, Script, Shot } from './productionManager'
import type {
  PromptEntry,
  PromptEntryInput,
  PromptEntryUpdates,
  Recipe,
  RatingInput,
  RatingUpdates,
} from './promptLabManager'
import type {
  SfxEntry,
  SfxEntryInput,
  SfxEntryUpdates,
  SfxRecipe,
  SfxRatingInput,
  SfxRatingUpdates,
} from './sfxLibraryManager'
import type { AiMessage, AiAssistantContext } from './aiAssistantManager'
import type { MediaLibraryEntry, ExportFile } from './mediaLibraryManager'
import type { ShotStatus } from './shotStatus'
import type { PromptLabKind } from './promptLabTypes'
import type { AddClipInput, ClipUpdates } from './editorManager'
import type { ExportProgress, ExportRange, GifExportOptions, StillFrameOptions } from './videoExportManager'
import type { ProjectSettings, Timeline, TrackType } from './editorTypes'
import type { LibraryLocation, RelocateLibraryResult } from './libraryRelocationManager'

const api = {
  listProjects: (): Promise<ProjectSummary[]> => ipcRenderer.invoke('projects:list'),
  createProject: (name: string): Promise<ProjectSummary> => ipcRenderer.invoke('projects:create', name),
  getProject: (id: string): Promise<ProjectSummary | null> => ipcRenderer.invoke('projects:get', id),
  deleteProject: (id: string): Promise<void> => ipcRenderer.invoke('projects:delete', id),
  openProjectFolder: (id: string): Promise<void> => ipcRenderer.invoke('projects:openFolder', id),

  listAssets: (projectId: string): Promise<Asset[]> => ipcRenderer.invoke('assets:list', projectId),
  importAssets: (projectId: string): Promise<Asset[]> => ipcRenderer.invoke('assets:import', projectId),
  deleteAsset: (projectId: string, assetId: string): Promise<Asset[]> =>
    ipcRenderer.invoke('assets:delete', projectId, assetId),
  extractAudioAsset: (projectId: string, assetId: string): Promise<Asset[]> =>
    ipcRenderer.invoke('assets:extractAudio', projectId, assetId),

  getIdea: (projectId: string): Promise<Idea> => ipcRenderer.invoke('idea:get', projectId),
  saveIdea: (projectId: string, content: string): Promise<Idea> =>
    ipcRenderer.invoke('idea:save', projectId, content),

  getScript: (projectId: string): Promise<Script> => ipcRenderer.invoke('script:get', projectId),
  saveScript: (projectId: string, content: string): Promise<Script> =>
    ipcRenderer.invoke('script:save', projectId, content),

  listScenes: (projectId: string): Promise<Scene[]> => ipcRenderer.invoke('scenes:list', projectId),
  createScene: (projectId: string, title: string, description?: string): Promise<Scene[]> =>
    ipcRenderer.invoke('scenes:create', projectId, title, description),
  updateScene: (
    projectId: string,
    sceneId: string,
    updates: { title?: string; description?: string; linkedSongAssetIds?: string[] },
  ): Promise<Scene[]> => ipcRenderer.invoke('scenes:update', projectId, sceneId, updates),
  deleteScene: (projectId: string, sceneId: string): Promise<{ scenes: Scene[]; shots: Shot[] }> =>
    ipcRenderer.invoke('scenes:delete', projectId, sceneId),
  moveScene: (projectId: string, sceneId: string, direction: 'up' | 'down'): Promise<Scene[]> =>
    ipcRenderer.invoke('scenes:move', projectId, sceneId, direction),

  listShots: (projectId: string, sceneId?: string): Promise<Shot[]> =>
    ipcRenderer.invoke('shots:list', projectId, sceneId),
  createShot: (projectId: string, sceneId: string, title: string, description?: string): Promise<Shot[]> =>
    ipcRenderer.invoke('shots:create', projectId, sceneId, title, description),
  updateShot: (
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
  ): Promise<Shot[]> => ipcRenderer.invoke('shots:update', projectId, shotId, updates),
  deleteShot: (projectId: string, shotId: string): Promise<Shot[]> =>
    ipcRenderer.invoke('shots:delete', projectId, shotId),
  moveShot: (projectId: string, shotId: string, direction: 'up' | 'down'): Promise<Shot[]> =>
    ipcRenderer.invoke('shots:move', projectId, shotId, direction),

  generateSceneOutline: (projectId: string, scriptText: string): Promise<GeneratedSceneOutline[]> =>
    ipcRenderer.invoke('ai:generateSceneOutline', projectId, scriptText),
  applyGeneratedOutline: (
    projectId: string,
    generated: GeneratedSceneOutline[],
    mode: 'add' | 'replace',
  ): Promise<{ scenes: Scene[]; shots: Shot[] }> =>
    ipcRenderer.invoke('scenes:applyGenerated', projectId, generated, mode),

  listPromptEntries: (projectId: string, kind: PromptLabKind): Promise<PromptEntry[]> =>
    ipcRenderer.invoke('promptlab:list', projectId, kind),
  createPromptEntry: (projectId: string, kind: PromptLabKind, input: PromptEntryInput): Promise<PromptEntry[]> =>
    ipcRenderer.invoke('promptlab:create', projectId, kind, input),
  updatePromptEntry: (
    projectId: string,
    kind: PromptLabKind,
    entryId: string,
    updates: PromptEntryUpdates,
  ): Promise<PromptEntry[]> => ipcRenderer.invoke('promptlab:update', projectId, kind, entryId, updates),
  deletePromptEntry: (projectId: string, kind: PromptLabKind, entryId: string): Promise<PromptEntry[]> =>
    ipcRenderer.invoke('promptlab:delete', projectId, kind, entryId),

  addRating: (
    projectId: string,
    kind: PromptLabKind,
    entryId: string,
    input: RatingInput,
  ): Promise<PromptEntry[]> => ipcRenderer.invoke('promptlab:rating:add', projectId, kind, entryId, input),
  updateRating: (
    projectId: string,
    kind: PromptLabKind,
    entryId: string,
    ratingId: string,
    updates: RatingUpdates,
  ): Promise<PromptEntry[]> =>
    ipcRenderer.invoke('promptlab:rating:update', projectId, kind, entryId, ratingId, updates),
  deleteRating: (
    projectId: string,
    kind: PromptLabKind,
    entryId: string,
    ratingId: string,
  ): Promise<PromptEntry[]> =>
    ipcRenderer.invoke('promptlab:rating:delete', projectId, kind, entryId, ratingId),

  listRecipes: (projectId: string, kind: PromptLabKind): Promise<Recipe[]> =>
    ipcRenderer.invoke('promptlab:recipe:list', projectId, kind),
  promoteToRecipe: (projectId: string, kind: PromptLabKind, entryId: string, name: string): Promise<Recipe[]> =>
    ipcRenderer.invoke('promptlab:recipe:promote', projectId, kind, entryId, name),
  updateRecipe: (
    projectId: string,
    kind: PromptLabKind,
    recipeId: string,
    updates: {
      name?: string
      promptText?: string
      lyrics?: string
      settings?: string
      notes?: string
      tags?: string[]
    },
  ): Promise<Recipe[]> => ipcRenderer.invoke('promptlab:recipe:update', projectId, kind, recipeId, updates),
  deleteRecipe: (projectId: string, kind: PromptLabKind, recipeId: string): Promise<Recipe[]> =>
    ipcRenderer.invoke('promptlab:recipe:delete', projectId, kind, recipeId),

  listSfxEntries: (projectId: string): Promise<SfxEntry[]> => ipcRenderer.invoke('sfx:list', projectId),
  createSfxEntry: (projectId: string, input: SfxEntryInput): Promise<SfxEntry[]> =>
    ipcRenderer.invoke('sfx:create', projectId, input),
  updateSfxEntry: (projectId: string, sfxId: string, updates: SfxEntryUpdates): Promise<SfxEntry[]> =>
    ipcRenderer.invoke('sfx:update', projectId, sfxId, updates),
  deleteSfxEntry: (projectId: string, sfxId: string): Promise<SfxEntry[]> =>
    ipcRenderer.invoke('sfx:delete', projectId, sfxId),

  addSfxRating: (projectId: string, sfxId: string, input: SfxRatingInput): Promise<SfxEntry[]> =>
    ipcRenderer.invoke('sfx:rating:add', projectId, sfxId, input),
  updateSfxRating: (
    projectId: string,
    sfxId: string,
    ratingId: string,
    updates: SfxRatingUpdates,
  ): Promise<SfxEntry[]> => ipcRenderer.invoke('sfx:rating:update', projectId, sfxId, ratingId, updates),
  deleteSfxRating: (projectId: string, sfxId: string, ratingId: string): Promise<SfxEntry[]> =>
    ipcRenderer.invoke('sfx:rating:delete', projectId, sfxId, ratingId),

  listSfxRecipes: (projectId: string): Promise<SfxRecipe[]> => ipcRenderer.invoke('sfx:recipe:list', projectId),
  promoteSfxRecipe: (projectId: string, sfxId: string, name: string): Promise<SfxRecipe[]> =>
    ipcRenderer.invoke('sfx:recipe:promote', projectId, sfxId, name),
  updateSfxRecipe: (
    projectId: string,
    recipeId: string,
    updates: { name?: string; promptText?: string; settings?: string; notes?: string; tags?: string[] },
  ): Promise<SfxRecipe[]> => ipcRenderer.invoke('sfx:recipe:update', projectId, recipeId, updates),
  deleteSfxRecipe: (projectId: string, recipeId: string): Promise<SfxRecipe[]> =>
    ipcRenderer.invoke('sfx:recipe:delete', projectId, recipeId),

  hasApiKey: (): Promise<boolean> => ipcRenderer.invoke('settings:hasApiKey'),
  setApiKey: (key: string): Promise<boolean> => ipcRenderer.invoke('settings:setApiKey', key),
  clearApiKey: (): Promise<boolean> => ipcRenderer.invoke('settings:clearApiKey'),

  listAiMessages: (projectId: string, context: AiAssistantContext): Promise<AiMessage[]> =>
    ipcRenderer.invoke('ai:list', projectId, context),
  sendAiMessage: (projectId: string, context: AiAssistantContext, text: string): Promise<AiMessage[]> =>
    ipcRenderer.invoke('ai:send', projectId, context, text),
  getAiDraft: (projectId: string, context: AiAssistantContext): Promise<string> =>
    ipcRenderer.invoke('ai:getDraft', projectId, context),
  saveAiDraft: (projectId: string, context: AiAssistantContext, text: string): Promise<void> =>
    ipcRenderer.invoke('ai:saveDraft', projectId, context, text),

  getMediaLibrary: (projectId: string): Promise<MediaLibraryEntry[]> =>
    ipcRenderer.invoke('media:getLibrary', projectId),
  listExports: (projectId: string): Promise<ExportFile[]> => ipcRenderer.invoke('media:listExports', projectId),

  getTimeline: (projectId: string): Promise<Timeline> => ipcRenderer.invoke('editor:getTimeline', projectId),
  updateProjectSettings: (projectId: string, updates: Partial<ProjectSettings>): Promise<Timeline> =>
    ipcRenderer.invoke('editor:updateProjectSettings', projectId, updates),

  addTrack: (projectId: string, type: TrackType, name?: string): Promise<Timeline> =>
    ipcRenderer.invoke('editor:track:add', projectId, type, name),
  updateTrack: (
    projectId: string,
    trackId: string,
    updates: { name?: string; muted?: boolean; hidden?: boolean },
  ): Promise<Timeline> => ipcRenderer.invoke('editor:track:update', projectId, trackId, updates),
  deleteTrack: (projectId: string, trackId: string): Promise<Timeline> =>
    ipcRenderer.invoke('editor:track:delete', projectId, trackId),
  reorderTracks: (projectId: string, type: TrackType, orderedTrackIds: string[]): Promise<Timeline> =>
    ipcRenderer.invoke('editor:track:reorder', projectId, type, orderedTrackIds),

  addClip: (projectId: string, input: AddClipInput): Promise<Timeline> =>
    ipcRenderer.invoke('editor:clip:add', projectId, input),
  updateClip: (projectId: string, clipId: string, updates: ClipUpdates): Promise<Timeline> =>
    ipcRenderer.invoke('editor:clip:update', projectId, clipId, updates),
  deleteClip: (projectId: string, clipId: string): Promise<Timeline> =>
    ipcRenderer.invoke('editor:clip:delete', projectId, clipId),
  splitClip: (projectId: string, clipId: string, atTime: number): Promise<Timeline> =>
    ipcRenderer.invoke('editor:clip:split', projectId, clipId, atTime),
  duplicateClip: (projectId: string, clipId: string): Promise<Timeline> =>
    ipcRenderer.invoke('editor:clip:duplicate', projectId, clipId),
  extractClipAudio: (projectId: string, clipId: string): Promise<Timeline> =>
    ipcRenderer.invoke('editor:clip:extractAudio', projectId, clipId),

  getAssetMediaUrl: (projectId: string, assetId: string): Promise<string> =>
    ipcRenderer.invoke('editor:getAssetMediaUrl', projectId, assetId),
  getReverseProxyUrl: (projectId: string, clipId: string): Promise<string | null> =>
    ipcRenderer.invoke('editor:getReverseProxyUrl', projectId, clipId),
  onTimelineUpdated: (callback: (projectId: string) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, projectId: string) => callback(projectId)
    ipcRenderer.on('editor:timelineUpdated', listener)
    return () => ipcRenderer.removeListener('editor:timelineUpdated', listener)
  },

  chooseExportDestination: (): Promise<string | null> => ipcRenderer.invoke('editor:chooseExportDestination'),
  exportTimeline: (projectId: string, outputName: string, destinationDir?: string): Promise<{ outputPath: string }> =>
    ipcRenderer.invoke('editor:export', projectId, outputName, destinationDir),
  exportClip: (
    projectId: string,
    outputName: string,
    range: ExportRange,
    destinationDir?: string,
  ): Promise<{ outputPath: string }> => ipcRenderer.invoke('editor:exportClip', projectId, outputName, range, destinationDir),
  exportGif: (
    projectId: string,
    outputName: string,
    options: GifExportOptions,
    destinationDir?: string,
  ): Promise<{ outputPath: string }> => ipcRenderer.invoke('editor:exportGif', projectId, outputName, options, destinationDir),
  exportStillFrame: (
    projectId: string,
    outputName: string,
    options: StillFrameOptions,
    destinationDir?: string,
  ): Promise<{ outputPath: string }> =>
    ipcRenderer.invoke('editor:exportStillFrame', projectId, outputName, options, destinationDir),
  onExportProgress: (callback: (progress: ExportProgress) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, progress: ExportProgress) => callback(progress)
    ipcRenderer.on('editor:exportProgress', listener)
    return () => ipcRenderer.removeListener('editor:exportProgress', listener)
  },

  getLibraryLocation: (): Promise<LibraryLocation> => ipcRenderer.invoke('library:getLocation'),
  relocateLibrary: (): Promise<RelocateLibraryResult | null> => ipcRenderer.invoke('library:relocate'),
}

export type DanVideoStudioApi = typeof api

contextBridge.exposeInMainWorld('api', api)
