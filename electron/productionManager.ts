import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { readJsonFile, writeJsonFile } from './fsUtils'
import { requireProjectDir, touchProject } from './projectPaths'
import { SHOT_STATUSES, type ShotStatus } from './shotStatus'

// --- Data model -------------------------------------------------------
//
// Phase 2 (production planning) data lives inside each project's `script/`
// folder (see projectManager.ts for the rest of the project layout):
//
//   script/
//     script.json   the project's freeform script text
//     scenes.json   Scene[]
//     shots.json    Shot[] — each references its scene via sceneId
//
// Phase 4 added `idea/idea.json` — a second freeform text/markdown document
// (premise/plot brainstorming, ahead of script writing) in its own folder
// rather than `script/`, since it isn't part of the script itself. It's the
// same trivial shape as `Script` below and gets its own tiny read/write
// pair here rather than a whole new manager, per CLAUDE.md's "don't triple
// near-identical code" principle — it's one extra document, not a new
// subsystem shape.
//
// A shot moves through a fixed status sequence as production progresses
// (see electron/shotStatus.ts): Planned -> Prompt Ready -> Generated ->
// Imported -> Edited -> Complete. `linkedAssetId` is an optional pointer
// into the project's assets.json (projectManager.ts) once a
// generated/imported file has been brought into the project as an asset —
// this is the shot's single primary generated clip.
//
// Phase 5 added a second, separate link on shots: `linkedSfxIds`, an
// unordered list of ids into the unified SFX system
// (electron/sfxLibraryManager.ts) — not capped at one, since a shot can
// reasonably use several sound effects. It's deliberately its own field
// rather than folded into `linkedAssetId`, which stays the shot's one
// primary-clip link. Scenes got an analogous list, `linkedSongAssetIds` —
// ids into the project's assets.json (audio assets), also not capped at
// one, per Dan's example of wanting two different songs across one scene.
// Both lists default to `[]` for shots/scenes read from before this field
// existed (see `normalizeShot`/`normalizeScene` below).
//
// 2026-09-14 added a third link on shots: `linkedGrokEntryId`, an optional
// pointer to exactly one entry in the Grok Prompt Lab
// (electron/promptLabManager.ts, `kind: 'grok'`) — the "✨ Draft Grok
// Prompt" button's target. One entry per shot, not a list: the Prompt Lab
// already tracks multiple rated attempt-versions *within* one entry (its
// `parentId` version chain), so a shot needing more than one Grok attempt
// means creating new versions of that same entry, not linking a second
// entry. Deliberately separate from the shot's older standalone
// `promptText`/Copy-Prompt field (Phase 2) — whether those two should
// eventually merge is an open question, not resolved by this field.
// Defaults to `null` for shots read from before this field existed (see
// `normalizeShot` below).
//
// Within a scene's shots (and within the project's scenes), `order` is
// always kept as a contiguous 0..n-1 permutation — every mutation either
// appends the next integer or renumbers/swaps in place — so callers can
// sort by it directly.

export interface Script {
  content: string
  updatedAt: string
}

export interface Idea {
  content: string
  updatedAt: string
}

export interface Scene {
  id: string
  title: string
  description: string
  order: number
  /** Ids into assets.json (audio assets) — the songs linked to this scene. Not capped at one. */
  linkedSongAssetIds: string[]
  createdAt: string
  updatedAt: string
}

export interface Shot {
  id: string
  sceneId: string
  title: string
  description: string
  promptText: string
  status: ShotStatus
  order: number
  linkedAssetId: string | null
  /** Ids into the unified SFX system (sfxLibraryManager.ts) — the SFX linked to this shot. Not capped at one. */
  linkedSfxIds: string[]
  /** Id of this shot's Grok Prompt Lab entry (promptLabManager.ts, kind 'grok'), if drafted. At most one. */
  linkedGrokEntryId: string | null
  createdAt: string
  updatedAt: string
}

// --- AI-generated scene/shot outline (2026-09-14) ------------------------
//
// The "Generate Scenes & Shots" action (Script tab) sends the project's
// script text to the Anthropic API — see aiAssistantManager.ts's
// `generateSceneOutline`, which returns this shape — and this manager's
// `applyGeneratedOutline` below turns it into real Scene/Shot records.
// Title/description only, deliberately: no Grok prompt text gets
// auto-populated here, that stays a separate, more detailed Prompt Lab
// step. This type lives here rather than in aiAssistantManager.ts because
// it's fundamentally "input for creating scenes/shots" — the same role
// `createScene`/`createShot`'s parameters play — the AI is just the one
// producing it in bulk instead of a human typing one at a time.

export interface GeneratedShotOutline {
  title: string
  description: string
}

export interface GeneratedSceneOutline {
  title: string
  description: string
  shots: GeneratedShotOutline[]
}

const EMPTY_SCRIPT: Script = { content: '', updatedAt: '' }
const EMPTY_IDEA: Idea = { content: '', updatedAt: '' }

function scriptPath(dir: string): string {
  return path.join(dir, 'script', 'script.json')
}
function ideaPath(dir: string): string {
  return path.join(dir, 'idea', 'idea.json')
}
function scenesPath(dir: string): string {
  return path.join(dir, 'script', 'scenes.json')
}
function shotsPath(dir: string): string {
  return path.join(dir, 'script', 'shots.json')
}

function sortByOrder<T extends { order: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.order - b.order)
}

/** Backfills `linkedSongAssetIds` for scenes read from before that field existed. */
function normalizeScene(scene: Scene): Scene {
  return { ...scene, linkedSongAssetIds: scene.linkedSongAssetIds ?? [] }
}

/** Backfills `linkedSfxIds`/`linkedGrokEntryId` for shots read from before those fields existed. */
function normalizeShot(shot: Shot): Shot {
  return { ...shot, linkedSfxIds: shot.linkedSfxIds ?? [], linkedGrokEntryId: shot.linkedGrokEntryId ?? null }
}

/** Re-numbers `order` to a contiguous 0..n-1 by current relative order, in place. */
function normalizeOrder<T extends { order: number }>(items: T[]): void {
  sortByOrder(items).forEach((item, i) => {
    item.order = i
  })
}

/** Swaps the `order` of `id` with its neighbor in `direction`, in place. */
function swapByOrder<T extends { id: string; order: number }>(
  items: T[],
  id: string,
  direction: 'up' | 'down',
): void {
  const ordered = sortByOrder(items)
  const index = ordered.findIndex((item) => item.id === id)
  if (index === -1) throw new Error('Item not found.')
  const swapIndex = direction === 'up' ? index - 1 : index + 1
  if (swapIndex < 0 || swapIndex >= ordered.length) return
  const a = ordered[index]
  const b = ordered[swapIndex]
  const tmp = a.order
  a.order = b.order
  b.order = tmp
}

export class ProductionManager {
  // --- Idea ---------------------------------------------------------------

  async getIdea(projectId: string): Promise<Idea> {
    const dir = await requireProjectDir(projectId)
    return readJsonFile<Idea>(ideaPath(dir), EMPTY_IDEA)
  }

  async saveIdea(projectId: string, content: string): Promise<Idea> {
    const dir = await requireProjectDir(projectId)
    const idea: Idea = { content, updatedAt: new Date().toISOString() }
    await writeJsonFile(ideaPath(dir), idea)
    await touchProject(dir)
    return idea
  }

  // --- Script ---------------------------------------------------------

  async getScript(projectId: string): Promise<Script> {
    const dir = await requireProjectDir(projectId)
    return readJsonFile<Script>(scriptPath(dir), EMPTY_SCRIPT)
  }

  async saveScript(projectId: string, content: string): Promise<Script> {
    const dir = await requireProjectDir(projectId)
    const script: Script = { content, updatedAt: new Date().toISOString() }
    await writeJsonFile(scriptPath(dir), script)
    await touchProject(dir)
    return script
  }

  // --- Scenes -----------------------------------------------------------

  async listScenes(projectId: string): Promise<Scene[]> {
    const dir = await requireProjectDir(projectId)
    return sortByOrder(await this.readScenes(dir))
  }

  async createScene(projectId: string, title: string, description = ''): Promise<Scene[]> {
    const trimmed = title.trim()
    if (!trimmed) throw new Error('Scene title cannot be empty.')

    const dir = await requireProjectDir(projectId)
    const scenes = await this.readScenes(dir)
    const now = new Date().toISOString()
    scenes.push({
      id: randomUUID(),
      title: trimmed,
      description,
      order: scenes.length,
      linkedSongAssetIds: [],
      createdAt: now,
      updatedAt: now,
    })
    await this.writeScenes(dir, scenes)
    await touchProject(dir)
    return sortByOrder(scenes)
  }

  async updateScene(
    projectId: string,
    sceneId: string,
    updates: { title?: string; description?: string; linkedSongAssetIds?: string[] },
  ): Promise<Scene[]> {
    const dir = await requireProjectDir(projectId)
    const scenes = await this.readScenes(dir)
    const scene = scenes.find((s) => s.id === sceneId)
    if (!scene) throw new Error('Scene not found.')

    if (updates.title !== undefined) {
      const trimmed = updates.title.trim()
      if (!trimmed) throw new Error('Scene title cannot be empty.')
      scene.title = trimmed
    }
    if (updates.description !== undefined) scene.description = updates.description
    if (updates.linkedSongAssetIds !== undefined) scene.linkedSongAssetIds = updates.linkedSongAssetIds
    scene.updatedAt = new Date().toISOString()

    await this.writeScenes(dir, scenes)
    await touchProject(dir)
    return sortByOrder(scenes)
  }

  /** Deletes a scene and cascades to delete every shot that belonged to it. */
  async deleteScene(projectId: string, sceneId: string): Promise<{ scenes: Scene[]; shots: Shot[] }> {
    const dir = await requireProjectDir(projectId)

    const scenes = (await this.readScenes(dir)).filter((s) => s.id !== sceneId)
    normalizeOrder(scenes)
    await this.writeScenes(dir, scenes)

    const shots = (await this.readShots(dir)).filter((s) => s.sceneId !== sceneId)
    await this.writeShots(dir, shots)

    await touchProject(dir)
    return { scenes: sortByOrder(scenes), shots: sortByOrder(shots) }
  }

  async moveScene(projectId: string, sceneId: string, direction: 'up' | 'down'): Promise<Scene[]> {
    const dir = await requireProjectDir(projectId)
    const scenes = await this.readScenes(dir)
    swapByOrder(scenes, sceneId, direction)
    await this.writeScenes(dir, scenes)
    await touchProject(dir)
    return sortByOrder(scenes)
  }

  private async readScenes(dir: string): Promise<Scene[]> {
    return (await readJsonFile<Scene[]>(scenesPath(dir), [])).map(normalizeScene)
  }

  private async writeScenes(dir: string, scenes: Scene[]): Promise<void> {
    await writeJsonFile(scenesPath(dir), scenes)
  }

  // --- Shots --------------------------------------------------------------

  /** All shots for a project, optionally narrowed to one scene, in display order. */
  async listShots(projectId: string, sceneId?: string): Promise<Shot[]> {
    const dir = await requireProjectDir(projectId)
    const shots = await this.readShots(dir)
    return sortByOrder(sceneId ? shots.filter((s) => s.sceneId === sceneId) : shots)
  }

  async createShot(projectId: string, sceneId: string, title: string, description = ''): Promise<Shot[]> {
    const trimmed = title.trim()
    if (!trimmed) throw new Error('Shot title cannot be empty.')

    const dir = await requireProjectDir(projectId)
    const scenes = await this.readScenes(dir)
    if (!scenes.some((s) => s.id === sceneId)) throw new Error('Scene not found.')

    const shots = await this.readShots(dir)
    const siblingCount = shots.filter((s) => s.sceneId === sceneId).length
    const now = new Date().toISOString()
    shots.push({
      id: randomUUID(),
      sceneId,
      title: trimmed,
      description,
      promptText: '',
      status: 'planned',
      order: siblingCount,
      linkedAssetId: null,
      linkedSfxIds: [],
      linkedGrokEntryId: null,
      createdAt: now,
      updatedAt: now,
    })
    await this.writeShots(dir, shots)
    await touchProject(dir)
    return sortByOrder(shots)
  }

  async updateShot(
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
  ): Promise<Shot[]> {
    const dir = await requireProjectDir(projectId)
    const shots = await this.readShots(dir)
    const shot = shots.find((s) => s.id === shotId)
    if (!shot) throw new Error('Shot not found.')

    if (updates.title !== undefined) {
      const trimmed = updates.title.trim()
      if (!trimmed) throw new Error('Shot title cannot be empty.')
      shot.title = trimmed
    }
    if (updates.description !== undefined) shot.description = updates.description
    if (updates.promptText !== undefined) shot.promptText = updates.promptText
    if (updates.status !== undefined) {
      if (!SHOT_STATUSES.includes(updates.status)) throw new Error('Invalid shot status.')
      shot.status = updates.status
    }
    if (updates.linkedAssetId !== undefined) shot.linkedAssetId = updates.linkedAssetId
    if (updates.linkedSfxIds !== undefined) shot.linkedSfxIds = updates.linkedSfxIds
    if (updates.linkedGrokEntryId !== undefined) shot.linkedGrokEntryId = updates.linkedGrokEntryId
    shot.updatedAt = new Date().toISOString()

    await this.writeShots(dir, shots)
    await touchProject(dir)
    return sortByOrder(shots)
  }

  async deleteShot(projectId: string, shotId: string): Promise<Shot[]> {
    const dir = await requireProjectDir(projectId)
    const shots = await this.readShots(dir)
    const target = shots.find((s) => s.id === shotId)
    if (!target) throw new Error('Shot not found.')

    const remaining = shots.filter((s) => s.id !== shotId)
    normalizeOrder(remaining.filter((s) => s.sceneId === target.sceneId))
    await this.writeShots(dir, remaining)
    await touchProject(dir)
    return sortByOrder(remaining)
  }

  async moveShot(projectId: string, shotId: string, direction: 'up' | 'down'): Promise<Shot[]> {
    const dir = await requireProjectDir(projectId)
    const shots = await this.readShots(dir)
    const shot = shots.find((s) => s.id === shotId)
    if (!shot) throw new Error('Shot not found.')

    swapByOrder(
      shots.filter((s) => s.sceneId === shot.sceneId),
      shotId,
      direction,
    )
    await this.writeShots(dir, shots)
    await touchProject(dir)
    return sortByOrder(shots)
  }

  private async readShots(dir: string): Promise<Shot[]> {
    return (await readJsonFile<Shot[]>(shotsPath(dir), [])).map(normalizeShot)
  }

  private async writeShots(dir: string, shots: Shot[]): Promise<void> {
    await writeJsonFile(shotsPath(dir), shots)
  }

  // --- AI-generated scene/shot outline -------------------------------------

  /**
   * Applies an AI-generated scene/shot outline (see aiAssistantManager.ts's
   * `generateSceneOutline`) to the project.
   *
   * `mode: 'add'` appends the generated scenes after whatever scenes/shots
   * already exist. `mode: 'replace'` discards the existing scenes/shots —
   * but not silently: per this project's repeated lesson about being
   * careful with real project data on destructive operations (see
   * CLAUDE.md/TODO.md's library-relocation incident), the current
   * scenes.json/shots.json are first snapshotted into a timestamped
   * `script/backups/<timestamp>/` folder before being overwritten, so a bad
   * generation can't actually destroy existing planning work — it's
   * recoverable from that folder (visible via "Open Folder"), not gone.
   * The caller (the renderer's Generate dialog) is responsible for asking
   * the user which mode to use when scenes already exist — this method
   * itself doesn't prompt, same as every other manager method.
   *
   * Generated shots default to 'planned' status and scenes/shots otherwise
   * get the same shape a manually-created one gets from createScene/
   * createShot (empty promptText, no linked asset/SFX/songs) — once
   * created, they're indistinguishable from a manually-added scene/shot.
   */
  async applyGeneratedOutline(
    projectId: string,
    generated: GeneratedSceneOutline[],
    mode: 'add' | 'replace',
  ): Promise<{ scenes: Scene[]; shots: Shot[] }> {
    const dir = await requireProjectDir(projectId)
    const existingScenes = await this.readScenes(dir)
    const existingShots = await this.readShots(dir)

    if (mode === 'replace' && (existingScenes.length > 0 || existingShots.length > 0)) {
      await this.backupScenesAndShots(dir, existingScenes, existingShots)
    }

    const baseScenes = mode === 'replace' ? [] : existingScenes
    const baseShots = mode === 'replace' ? [] : existingShots
    let sceneOrder = baseScenes.length
    const now = new Date().toISOString()

    const newScenes: Scene[] = []
    const newShots: Shot[] = []
    for (const g of generated) {
      const scene: Scene = {
        id: randomUUID(),
        title: g.title.trim() || 'Untitled Scene',
        description: g.description ?? '',
        order: sceneOrder++,
        linkedSongAssetIds: [],
        createdAt: now,
        updatedAt: now,
      }
      newScenes.push(scene)

      let shotOrder = 0
      for (const gs of g.shots) {
        newShots.push({
          id: randomUUID(),
          sceneId: scene.id,
          title: gs.title.trim() || 'Untitled Shot',
          description: gs.description ?? '',
          promptText: '',
          status: 'planned',
          order: shotOrder++,
          linkedAssetId: null,
          linkedSfxIds: [],
          linkedGrokEntryId: null,
          createdAt: now,
          updatedAt: now,
        })
      }
    }

    const scenes = [...baseScenes, ...newScenes]
    const shots = [...baseShots, ...newShots]
    await this.writeScenes(dir, scenes)
    await this.writeShots(dir, shots)
    await touchProject(dir)
    return { scenes: sortByOrder(scenes), shots: sortByOrder(shots) }
  }

  /** Snapshots the current scenes/shots to a timestamped backup folder before a destructive replace. */
  private async backupScenesAndShots(dir: string, scenes: Scene[], shots: Shot[]): Promise<void> {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backupDir = path.join(dir, 'script', 'backups', stamp)
    await writeJsonFile(path.join(backupDir, 'scenes.json'), scenes)
    await writeJsonFile(path.join(backupDir, 'shots.json'), shots)
  }
}
