// Type-only bridge to the Electron main process types. The preload script
// implements this exact shape and exposes it via contextBridge — see
// electron/preload.ts, electron/projectManager.ts, and
// electron/productionManager.ts.
import type { Asset, AssetKind, ProjectSummary } from '../electron/projectManager'
import type { Scene, Script, Shot } from '../electron/productionManager'
import type { ShotStatus } from '../electron/shotStatus'

export type { Asset, AssetKind, ProjectSummary, Scene, Script, Shot, ShotStatus }

// Note: this file is a .d.ts (declarations only, no JS emitted), so it can
// only carry `export type` re-exports — a real runtime import here would
// have nothing to resolve to at build time. Components that need the actual
// SHOT_STATUSES/SHOT_STATUS_LABELS values import them directly from
// electron/shotStatus.ts (see that file's header comment for why that's
// safe to bundle into the renderer even though it lives under electron/).

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

      getScript(projectId: string): Promise<Script>
      saveScript(projectId: string, content: string): Promise<Script>

      listScenes(projectId: string): Promise<Scene[]>
      createScene(projectId: string, title: string, description?: string): Promise<Scene[]>
      updateScene(
        projectId: string,
        sceneId: string,
        updates: { title?: string; description?: string },
      ): Promise<Scene[]>
      deleteScene(projectId: string, sceneId: string): Promise<{ scenes: Scene[]; shots: Shot[] }>
      moveScene(projectId: string, sceneId: string, direction: 'up' | 'down'): Promise<Scene[]>

      listShots(projectId: string, sceneId?: string): Promise<Shot[]>
      createShot(
        projectId: string,
        sceneId: string,
        title: string,
        description?: string,
      ): Promise<Shot[]>
      updateShot(
        projectId: string,
        shotId: string,
        updates: {
          title?: string
          description?: string
          promptText?: string
          status?: ShotStatus
          linkedAssetId?: string | null
        },
      ): Promise<Shot[]>
      deleteShot(projectId: string, shotId: string): Promise<Shot[]>
      moveShot(projectId: string, shotId: string, direction: 'up' | 'down'): Promise<Shot[]>
    }
  }
}
