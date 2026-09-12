import { contextBridge, ipcRenderer } from 'electron'
import type { Asset, ProjectSummary } from './projectManager'
import type { Scene, Script, Shot } from './productionManager'
import type { ShotStatus } from './shotStatus'

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
}

export type DanVideoStudioApi = typeof api

contextBridge.exposeInMainWorld('api', api)
