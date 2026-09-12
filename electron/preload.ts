import { contextBridge, ipcRenderer } from 'electron'
import type { Asset, ProjectSummary } from './projectManager'

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
}

export type DanVideoStudioApi = typeof api

contextBridge.exposeInMainWorld('api', api)
