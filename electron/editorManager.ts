import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { readJsonFile, writeJsonFile } from './fsUtils'
import { requireProjectDir, touchProject } from './projectPaths'
import type { ProjectManager } from './projectManager'
import { probeMedia } from './mediaProbe'
import { buildMediaUrl } from './mediaProtocol'
import {
  DEFAULT_CHROMA_KEY,
  DEFAULT_PROJECT_SETTINGS,
  DEFAULT_TRANSITION,
  containTransform,
  defaultTextStyle,
  defaultTextTransform,
  type Clip,
  type ClipKind,
  type ProjectSettings,
  type Timeline,
  type Track,
  type TrackType,
} from './editorTypes'

// --- Data model -------------------------------------------------------
//
// Phase 6 (Video Editor) data lives in each project's new `editor/` folder:
//
//   editor/
//     timeline.json   Timeline — project canvas settings + tracks + clips
//
// A `Track` is a lane (video, audio, or overlay/text) — `order` is a
// contiguous 0..n-1 permutation *within its type* (a video track's order
// never collides with an audio track's), same "always renumber on mutation"
// convention as scenes/shots in productionManager.ts. Visual compositing
// (PreviewPlayer.tsx in the renderer, videoExportManager.ts for the real
// export) always draws every video track bottom-to-top by `order`, then
// every overlay track bottom-to-top by `order` on top of all video tracks —
// text/titles are deliberately always above the footage rather than
// interleavable with it, a deliberate simplification over a single combined
// z-index across track types.
//
// A `Clip` belongs to exactly one track and carries everything needed to
// place and render it: its timeline position (`startTime`/`duration`), its
// source trim (`inPoint`/`outPoint`, pre-speed source seconds — media clips
// only), `speed`/`volume`/fades, a `transform` (crop/scale/position — see
// editorTypes.ts), an optional `chromaKey`, and a `transitionOut` describing
// how it blends into whatever clip immediately follows it on the *same*
// track (see videoExportManager.ts for how that becomes an actual `xfade`/
// `acrossfade`). A clip's `assetId` points into the project's assets.json
// (projectManager.ts) — null only for `kind: 'text'` clips, which carry a
// `text` style block instead and render as a title/overlay with no source
// media. Splitting a clip (`splitClip`) produces two clips where the first
// half's `transitionOut` resets to 'none' and the second half inherits the
// original transitionOut, since a transition describes what happens at a
// clip's *tail* — see that method's comment.
//
// This manager doesn't touch FFmpeg itself — see videoExportManager.ts for
// the actual MP4 export, and mediaProbe.ts for how a clip's default
// trim/duration is derived from the real source file the one time it's
// added (via FFprobe), same "business logic in the main process" split as
// every other manager (per CLAUDE.md).

function timelinePath(dir: string): string {
  return path.join(dir, 'editor', 'timeline.json')
}

function defaultTimeline(): Timeline {
  const settings = DEFAULT_PROJECT_SETTINGS
  const now = () => randomUUID()
  const videoTrack: Track = { id: now(), type: 'video', name: 'Video 1', order: 0, muted: false, hidden: false }
  const audioTrack: Track = { id: now(), type: 'audio', name: 'Audio 1', order: 0, muted: false, hidden: false }
  return { projectSettings: settings, tracks: [videoTrack, audioTrack], clips: [] }
}

/** Backfills fields added after a project's timeline.json was first written. */
function normalizeClip(clip: Clip): Clip {
  return {
    ...clip,
    volume: clip.volume ?? 1,
    includeAudio: clip.includeAudio ?? true,
    fadeInDuration: clip.fadeInDuration ?? 0,
    fadeOutDuration: clip.fadeOutDuration ?? 0,
    sourceWidth: clip.sourceWidth ?? null,
    sourceHeight: clip.sourceHeight ?? null,
    crop: clip.crop ?? null,
    chromaKey: clip.chromaKey ?? { ...DEFAULT_CHROMA_KEY },
    transitionOut: clip.transitionOut ?? { ...DEFAULT_TRANSITION, type: 'none' },
  }
}

function normalizeTimeline(timeline: Timeline): Timeline {
  return {
    projectSettings: { ...DEFAULT_PROJECT_SETTINGS, ...timeline.projectSettings },
    tracks: timeline.tracks ?? [],
    clips: (timeline.clips ?? []).map(normalizeClip),
  }
}

function trackTypeOrders(tracks: Track[], type: TrackType): Track[] {
  return tracks.filter((t) => t.type === type).sort((a, b) => a.order - b.order)
}

function renumberTrackType(tracks: Track[], type: TrackType): void {
  trackTypeOrders(tracks, type).forEach((t, i) => {
    t.order = i
  })
}

const DEFAULT_IMAGE_DURATION = 5
const DEFAULT_TEXT_DURATION = 3

export interface AddClipInput {
  trackId: string
  assetId: string | null
  kind: ClipKind
  startTime: number
}

export type ClipUpdates = Partial<
  Pick<
    Clip,
    | 'trackId'
    | 'startTime'
    | 'duration'
    | 'inPoint'
    | 'outPoint'
    | 'speed'
    | 'volume'
    | 'includeAudio'
    | 'fadeInDuration'
    | 'fadeOutDuration'
    | 'crop'
    | 'transform'
    | 'chromaKey'
    | 'transitionOut'
    | 'text'
  >
>

export class EditorManager {
  constructor(private readonly projectManager: ProjectManager) {}

  async getTimeline(projectId: string): Promise<Timeline> {
    const dir = await requireProjectDir(projectId)
    return this.readTimeline(dir)
  }

  async updateProjectSettings(projectId: string, updates: Partial<ProjectSettings>): Promise<Timeline> {
    const dir = await requireProjectDir(projectId)
    const timeline = await this.readTimeline(dir)
    timeline.projectSettings = { ...timeline.projectSettings, ...updates }
    await this.writeTimeline(dir, timeline)
    return timeline
  }

  // --- Tracks -------------------------------------------------------------

  async addTrack(projectId: string, type: TrackType, name?: string): Promise<Timeline> {
    const dir = await requireProjectDir(projectId)
    const timeline = await this.readTimeline(dir)
    const siblingCount = trackTypeOrders(timeline.tracks, type).length
    const labelPrefix = type === 'video' ? 'Video' : type === 'audio' ? 'Audio' : 'Overlay'
    timeline.tracks.push({
      id: randomUUID(),
      type,
      name: name?.trim() || `${labelPrefix} ${siblingCount + 1}`,
      order: siblingCount,
      muted: false,
      hidden: false,
    })
    await this.writeTimeline(dir, timeline)
    return timeline
  }

  async updateTrack(
    projectId: string,
    trackId: string,
    updates: { name?: string; muted?: boolean; hidden?: boolean },
  ): Promise<Timeline> {
    const dir = await requireProjectDir(projectId)
    const timeline = await this.readTimeline(dir)
    const track = timeline.tracks.find((t) => t.id === trackId)
    if (!track) throw new Error('Track not found.')
    if (updates.name !== undefined) {
      const trimmed = updates.name.trim()
      if (!trimmed) throw new Error('Track name cannot be empty.')
      track.name = trimmed
    }
    if (updates.muted !== undefined) track.muted = updates.muted
    if (updates.hidden !== undefined) track.hidden = updates.hidden
    await this.writeTimeline(dir, timeline)
    return timeline
  }

  async deleteTrack(projectId: string, trackId: string): Promise<Timeline> {
    const dir = await requireProjectDir(projectId)
    const timeline = await this.readTimeline(dir)
    const track = timeline.tracks.find((t) => t.id === trackId)
    if (!track) throw new Error('Track not found.')

    timeline.tracks = timeline.tracks.filter((t) => t.id !== trackId)
    timeline.clips = timeline.clips.filter((c) => c.trackId !== trackId)
    renumberTrackType(timeline.tracks, track.type)

    await this.writeTimeline(dir, timeline)
    return timeline
  }

  async reorderTracks(projectId: string, type: TrackType, orderedTrackIds: string[]): Promise<Timeline> {
    const dir = await requireProjectDir(projectId)
    const timeline = await this.readTimeline(dir)
    const byId = new Map(timeline.tracks.filter((t) => t.type === type).map((t) => [t.id, t]))
    if (byId.size !== orderedTrackIds.length || orderedTrackIds.some((id) => !byId.has(id))) {
      throw new Error('reorderTracks must list every track of that type exactly once.')
    }
    orderedTrackIds.forEach((id, i) => {
      byId.get(id)!.order = i
    })
    await this.writeTimeline(dir, timeline)
    return timeline
  }

  // --- Clips ----------------------------------------------------------------

  async addClip(projectId: string, input: AddClipInput): Promise<Timeline> {
    const dir = await requireProjectDir(projectId)
    const timeline = await this.readTimeline(dir)
    const track = timeline.tracks.find((t) => t.id === input.trackId)
    if (!track) throw new Error('Track not found.')

    const { width, height } = timeline.projectSettings

    let clip: Clip
    if (input.kind === 'text') {
      clip = {
        id: randomUUID(),
        trackId: input.trackId,
        kind: 'text',
        assetId: null,
        startTime: Math.max(0, input.startTime),
        duration: DEFAULT_TEXT_DURATION,
        inPoint: 0,
        outPoint: DEFAULT_TEXT_DURATION,
        speed: 1,
        volume: 1,
        includeAudio: false,
        fadeInDuration: 0,
        fadeOutDuration: 0,
        sourceWidth: null,
        sourceHeight: null,
        crop: null,
        transform: defaultTextTransform(width, height),
        chromaKey: { ...DEFAULT_CHROMA_KEY },
        transitionOut: { ...DEFAULT_TRANSITION, type: 'none' },
        text: defaultTextStyle(),
      }
    } else {
      if (!input.assetId) throw new Error('A media clip needs an assetId.')
      const assets = await this.projectManager.listAssets(projectId)
      const asset = assets.find((a) => a.id === input.assetId)
      if (!asset) throw new Error('Asset not found.')

      let sourceDuration = DEFAULT_IMAGE_DURATION
      let hasAudio = false
      let sourceWidth: number | null = null
      let sourceHeight: number | null = null
      if (asset.kind !== 'audio') {
        const absPath = await this.projectManager.getAssetAbsolutePath(projectId, asset.id)
        try {
          const info = await probeMedia(absPath)
          sourceWidth = info.width
          sourceHeight = info.height
          hasAudio = info.hasAudio
          if (asset.kind !== 'image' && info.durationSec > 0) sourceDuration = info.durationSec
        } catch {
          // Fall back to defaults below — a corrupt/unreadable file shouldn't block adding it.
        }
      }
      if (asset.kind === 'audio') {
        const absPath = await this.projectManager.getAssetAbsolutePath(projectId, asset.id)
        try {
          const info = await probeMedia(absPath)
          if (info.durationSec > 0) sourceDuration = info.durationSec
          hasAudio = true
        } catch {
          // same fallback as above
        }
      }

      clip = {
        id: randomUUID(),
        trackId: input.trackId,
        kind: 'media',
        assetId: asset.id,
        startTime: Math.max(0, input.startTime),
        duration: sourceDuration,
        inPoint: 0,
        outPoint: sourceDuration,
        speed: 1,
        volume: 1,
        includeAudio: hasAudio,
        fadeInDuration: 0,
        fadeOutDuration: 0,
        sourceWidth,
        sourceHeight,
        crop: null,
        transform: containTransform(width, height, sourceWidth, sourceHeight),
        chromaKey: { ...DEFAULT_CHROMA_KEY },
        transitionOut: { ...DEFAULT_TRANSITION, type: 'none' },
        text: null,
      }
    }

    timeline.clips.push(clip)
    await this.writeTimeline(dir, timeline)
    await touchProject(dir)
    return timeline
  }

  async updateClip(projectId: string, clipId: string, updates: ClipUpdates): Promise<Timeline> {
    const dir = await requireProjectDir(projectId)
    const timeline = await this.readTimeline(dir)
    const clip = timeline.clips.find((c) => c.id === clipId)
    if (!clip) throw new Error('Clip not found.')

    if (updates.trackId !== undefined) {
      if (!timeline.tracks.some((t) => t.id === updates.trackId)) throw new Error('Track not found.')
      clip.trackId = updates.trackId
    }
    if (updates.startTime !== undefined) clip.startTime = Math.max(0, updates.startTime)
    if (updates.inPoint !== undefined) clip.inPoint = Math.max(0, updates.inPoint)
    if (updates.outPoint !== undefined) clip.outPoint = Math.max(clip.inPoint + 0.05, updates.outPoint)
    if (updates.speed !== undefined) clip.speed = Math.min(4, Math.max(0.25, updates.speed))
    // For a media clip, on-timeline `duration` is always derived from its
    // source trim and speed (kept as an invariant, not independently
    // settable) — otherwise a stale `duration` could silently desync from
    // (outPoint-inPoint)/speed and the exported clip would end up shorter or
    // longer on the timeline than its overlay window expects. A text clip
    // has no source trim, so its `duration` stays directly settable.
    if (clip.kind === 'media') {
      clip.duration = (clip.outPoint - clip.inPoint) / clip.speed
    } else if (updates.duration !== undefined) {
      clip.duration = Math.max(0.05, updates.duration)
    }
    if (updates.volume !== undefined) clip.volume = Math.min(2, Math.max(0, updates.volume))
    if (updates.includeAudio !== undefined) clip.includeAudio = updates.includeAudio
    if (updates.fadeInDuration !== undefined) clip.fadeInDuration = Math.max(0, updates.fadeInDuration)
    if (updates.fadeOutDuration !== undefined) clip.fadeOutDuration = Math.max(0, updates.fadeOutDuration)
    if (updates.crop !== undefined) clip.crop = updates.crop
    if (updates.transform !== undefined) clip.transform = updates.transform
    if (updates.chromaKey !== undefined) clip.chromaKey = updates.chromaKey
    if (updates.transitionOut !== undefined) clip.transitionOut = updates.transitionOut
    if (updates.text !== undefined && clip.kind === 'text') clip.text = updates.text

    await this.writeTimeline(dir, timeline)
    await touchProject(dir)
    return timeline
  }

  async deleteClip(projectId: string, clipId: string): Promise<Timeline> {
    const dir = await requireProjectDir(projectId)
    const timeline = await this.readTimeline(dir)
    if (!timeline.clips.some((c) => c.id === clipId)) throw new Error('Clip not found.')
    timeline.clips = timeline.clips.filter((c) => c.id !== clipId)
    await this.writeTimeline(dir, timeline)
    await touchProject(dir)
    return timeline
  }

  /**
   * Splits a clip at an absolute timeline time into two adjacent clips.
   * The tail half keeps the original clip's id (so anything that might
   * reference it stays valid) and inherits its `transitionOut` — the head
   * half gets a fresh id and always resets to no transition, since a
   * transition describes the tail end of a clip and the two new halves are
   * now directly adjacent with no gap.
   */
  async splitClip(projectId: string, clipId: string, atTime: number): Promise<Timeline> {
    const dir = await requireProjectDir(projectId)
    const timeline = await this.readTimeline(dir)
    const clip = timeline.clips.find((c) => c.id === clipId)
    if (!clip) throw new Error('Clip not found.')

    const offset = atTime - clip.startTime
    if (offset <= 0.05 || offset >= clip.duration - 0.05) {
      throw new Error('Split point must be inside the clip.')
    }

    const head: Clip = {
      ...clip,
      id: randomUUID(),
      duration: offset,
      outPoint: clip.kind === 'media' ? clip.inPoint + offset * clip.speed : clip.outPoint,
      fadeOutDuration: 0,
      transitionOut: { ...DEFAULT_TRANSITION, type: 'none' },
    }
    const tailDuration = clip.duration - offset
    clip.startTime = clip.startTime + offset
    clip.duration = tailDuration
    if (clip.kind === 'media') clip.inPoint = clip.inPoint + offset * clip.speed
    clip.fadeInDuration = 0

    timeline.clips.push(head)
    await this.writeTimeline(dir, timeline)
    await touchProject(dir)
    return timeline
  }

  // --- Media playback (renderer preview) -------------------------------------

  /** A `media://` URL the renderer can set directly as a `<video>`/`<audio>`/`<img>` src. */
  async getAssetMediaUrl(projectId: string, assetId: string): Promise<string> {
    const absPath = await this.projectManager.getAssetAbsolutePath(projectId, assetId)
    return buildMediaUrl(absPath)
  }

  private async readTimeline(dir: string): Promise<Timeline> {
    const raw = await readJsonFile<Timeline | null>(timelinePath(dir), null)
    if (raw) return normalizeTimeline(raw)
    // First touch of this project's editor data — persist the freshly
    // generated default (with its randomly-generated default track ids)
    // immediately, rather than regenerating a *different* default (and
    // different track ids) on every call until something else writes it.
    // Otherwise a caller that reads the timeline once to capture track ids
    // and mutates it in a second call would silently be handed two
    // different sets of ids for a project that had never saved a timeline
    // yet.
    const fresh = defaultTimeline()
    await this.writeTimeline(dir, fresh)
    return fresh
  }

  private async writeTimeline(dir: string, timeline: Timeline): Promise<void> {
    await writeJsonFile(timelinePath(dir), timeline)
  }
}
