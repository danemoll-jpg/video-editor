// Type-only bridge to the Electron main process types. The preload script
// implements this exact shape and exposes it via contextBridge — see
// electron/preload.ts and electron/projectManager.ts.
import type { Asset, AssetKind, ProjectSummary } from '../electron/projectManager'

export type { Asset, AssetKind, ProjectSummary }

declare global {
  interface Window {
    api: {
      listProjects(): Promise<ProjectSummary[]>
      createProject(name: string): Promise<ProjectSummary>
      getProject(id: string): Promise<ProjectSummary | null>
      deleteProject(id: string): Promise<void>
      openProjectFolder(id: string): Promise<void>
      listAssets(projectId: string): Promise<Asset[]>
      importAssets(projectId: string): Promise<Asset[]>
      deleteAsset(projectId: string, assetId: string): Promise<Asset[]>
    }
  }
}
