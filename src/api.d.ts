// Type-only bridge to the Electron main process types. The preload script
// implements this exact shape and exposes it via contextBridge — see
// electron/preload.ts, electron/projectManager.ts, and
// electron/productionManager.ts.
import type { Asset, AssetKind, ProjectSummary } from '../electron/projectManager'
import type { Idea, Scene, Script, Shot } from '../electron/productionManager'
import type {
  PromptEntry,
  PromptEntryInput,
  PromptEntryUpdates,
  Recipe,
  RatingInput,
  RatingUpdates,
} from '../electron/promptLabManager'
import type {
  SfxEntry,
  SfxEntryInput,
  SfxEntryUpdates,
  SfxRecipe,
  SfxRatingInput,
  SfxRatingUpdates,
} from '../electron/sfxLibraryManager'
import type { AiMessage, AiAssistantContext } from '../electron/aiAssistantManager'
import type { MediaLibraryEntry, MediaUsage, ExportFile } from '../electron/mediaLibraryManager'
import type { ShotStatus } from '../electron/shotStatus'
import type { PromptLabKind } from '../electron/promptLabTypes'

export type {
  Asset,
  AssetKind,
  ProjectSummary,
  Idea,
  Scene,
  Script,
  Shot,
  ShotStatus,
  PromptEntry,
  PromptEntryInput,
  PromptEntryUpdates,
  Recipe,
  RatingInput,
  RatingUpdates,
  SfxEntry,
  SfxEntryInput,
  SfxEntryUpdates,
  SfxRecipe,
  SfxRatingInput,
  SfxRatingUpdates,
  PromptLabKind,
  AiMessage,
  AiAssistantContext,
  MediaLibraryEntry,
  MediaUsage,
  ExportFile,
}

// Note: this file is a .d.ts (declarations only, no JS emitted), so it can
// only carry `export type` re-exports — a real runtime import here would
// have nothing to resolve to at build time. Components that need the actual
// SHOT_STATUSES/SHOT_STATUS_LABELS or RATING_DIMENSIONS/PROMPT_LAB_LABELS
// values import them directly from electron/shotStatus.ts or
// electron/promptLabTypes.ts (see each file's header comment for why that's
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

      getIdea(projectId: string): Promise<Idea>
      saveIdea(projectId: string, content: string): Promise<Idea>

      getScript(projectId: string): Promise<Script>
      saveScript(projectId: string, content: string): Promise<Script>

      listScenes(projectId: string): Promise<Scene[]>
      createScene(projectId: string, title: string, description?: string): Promise<Scene[]>
      updateScene(
        projectId: string,
        sceneId: string,
        updates: { title?: string; description?: string; linkedSongAssetIds?: string[] },
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
          linkedSfxIds?: string[]
        },
      ): Promise<Shot[]>
      deleteShot(projectId: string, shotId: string): Promise<Shot[]>
      moveShot(projectId: string, shotId: string, direction: 'up' | 'down'): Promise<Shot[]>

      listPromptEntries(projectId: string, kind: PromptLabKind): Promise<PromptEntry[]>
      createPromptEntry(projectId: string, kind: PromptLabKind, input: PromptEntryInput): Promise<PromptEntry[]>
      updatePromptEntry(
        projectId: string,
        kind: PromptLabKind,
        entryId: string,
        updates: PromptEntryUpdates,
      ): Promise<PromptEntry[]>
      deletePromptEntry(projectId: string, kind: PromptLabKind, entryId: string): Promise<PromptEntry[]>

      addRating(projectId: string, kind: PromptLabKind, entryId: string, input: RatingInput): Promise<PromptEntry[]>
      updateRating(
        projectId: string,
        kind: PromptLabKind,
        entryId: string,
        ratingId: string,
        updates: RatingUpdates,
      ): Promise<PromptEntry[]>
      deleteRating(
        projectId: string,
        kind: PromptLabKind,
        entryId: string,
        ratingId: string,
      ): Promise<PromptEntry[]>

      listRecipes(projectId: string, kind: PromptLabKind): Promise<Recipe[]>
      promoteToRecipe(projectId: string, kind: PromptLabKind, entryId: string, name: string): Promise<Recipe[]>
      updateRecipe(
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
      ): Promise<Recipe[]>
      deleteRecipe(projectId: string, kind: PromptLabKind, recipeId: string): Promise<Recipe[]>

      listSfxEntries(projectId: string): Promise<SfxEntry[]>
      createSfxEntry(projectId: string, input: SfxEntryInput): Promise<SfxEntry[]>
      updateSfxEntry(projectId: string, sfxId: string, updates: SfxEntryUpdates): Promise<SfxEntry[]>
      deleteSfxEntry(projectId: string, sfxId: string): Promise<SfxEntry[]>

      addSfxRating(projectId: string, sfxId: string, input: SfxRatingInput): Promise<SfxEntry[]>
      updateSfxRating(
        projectId: string,
        sfxId: string,
        ratingId: string,
        updates: SfxRatingUpdates,
      ): Promise<SfxEntry[]>
      deleteSfxRating(projectId: string, sfxId: string, ratingId: string): Promise<SfxEntry[]>

      listSfxRecipes(projectId: string): Promise<SfxRecipe[]>
      promoteSfxRecipe(projectId: string, sfxId: string, name: string): Promise<SfxRecipe[]>
      updateSfxRecipe(
        projectId: string,
        recipeId: string,
        updates: { name?: string; promptText?: string; settings?: string; notes?: string; tags?: string[] },
      ): Promise<SfxRecipe[]>
      deleteSfxRecipe(projectId: string, recipeId: string): Promise<SfxRecipe[]>

      hasApiKey(): Promise<boolean>
      setApiKey(key: string): Promise<boolean>
      clearApiKey(): Promise<boolean>

      listAiMessages(projectId: string, context: AiAssistantContext): Promise<AiMessage[]>
      sendAiMessage(projectId: string, context: AiAssistantContext, text: string): Promise<AiMessage[]>

      getMediaLibrary(projectId: string): Promise<MediaLibraryEntry[]>
      listExports(projectId: string): Promise<ExportFile[]>
    }
  }
}
