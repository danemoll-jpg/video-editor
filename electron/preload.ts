import { contextBridge, ipcRenderer } from 'electron'
import type { Asset, ProjectSummary } from './projectManager'
import type { Scene, Script, Shot } from './productionManager'
import type {
  PromptEntry,
  PromptEntryInput,
  PromptEntryUpdates,
  Recipe,
  RatingInput,
  RatingUpdates,
} from './promptLabManager'
import type { SfxLibraryEntry, SfxLibraryEntryInput, SfxLibraryEntryUpdates } from './sfxLibraryManager'
import type { ShotStatus } from './shotStatus'
import type { PromptLabKind } from './promptLabTypes'

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

  getScript: (projectId: string): Promise<Script> => ipcRenderer.invoke('script:get', projectId),
  saveScript: (projectId: string, content: string): Promise<Script> =>
    ipcRenderer.invoke('script:save', projectId, content),

  listScenes: (projectId: string): Promise<Scene[]> => ipcRenderer.invoke('scenes:list', projectId),
  createScene: (projectId: string, title: string, description?: string): Promise<Scene[]> =>
    ipcRenderer.invoke('scenes:create', projectId, title, description),
  updateScene: (
    projectId: string,
    sceneId: string,
    updates: { title?: string; description?: string },
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
    },
  ): Promise<Shot[]> => ipcRenderer.invoke('shots:update', projectId, shotId, updates),
  deleteShot: (projectId: string, shotId: string): Promise<Shot[]> =>
    ipcRenderer.invoke('shots:delete', projectId, shotId),
  moveShot: (projectId: string, shotId: string, direction: 'up' | 'down'): Promise<Shot[]> =>
    ipcRenderer.invoke('shots:move', projectId, shotId, direction),

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

  listSfxEntries: (projectId: string): Promise<SfxLibraryEntry[]> => ipcRenderer.invoke('sfx:list', projectId),
  createSfxEntry: (projectId: string, input: SfxLibraryEntryInput): Promise<SfxLibraryEntry[]> =>
    ipcRenderer.invoke('sfx:create', projectId, input),
  updateSfxEntry: (
    projectId: string,
    sfxId: string,
    updates: SfxLibraryEntryUpdates,
  ): Promise<SfxLibraryEntry[]> => ipcRenderer.invoke('sfx:update', projectId, sfxId, updates),
  deleteSfxEntry: (projectId: string, sfxId: string): Promise<SfxLibraryEntry[]> =>
    ipcRenderer.invoke('sfx:delete', projectId, sfxId),
}

export type DanVideoStudioApi = typeof api

contextBridge.exposeInMainWorld('api', api)
