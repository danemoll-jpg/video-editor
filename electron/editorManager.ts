import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { readJsonFile, writeJsonFile } from './fsUtils'
import { requireProjectDir, touchProject } from './projectPaths'
import type { ProjectManager } from './projectManager'
import { probeMedia } from './mediaProbe'
import { buildMediaUrl } from './mediaProtocol'
import { renderReverseProxy } from './reverseProxyManager'
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
//     proxies/        cached reverse live-preview proxies, one small .mp4
//                      per clip currently rendered — see the "Reverse
//                      live-preview proxies" section below and
//                      reverseProxyManager.ts for how one is actually
//                      rendered via FFmpeg.
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
    reverse: clip.reverse ?? false,
    mirror: clip.mirror ?? false,
    reverseProxy: clip.reverseProxy ?? null,
  }
}

/** True when two trim/speed numbers are close enough to count as "the same" — floats round-tripped through JSON/UI shouldn't cause a spurious stale-proxy regenerate. */
function closeEnough(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.01
}

/** True when `clip` still actually wants the reverse-proxy render that was kicked off for `target` — i.e. nothing (reverse being turned off, a newer trim edit, a delete) superseded it while it was running. */
function isPendingFor(clip: Clip | undefined, target: { inPoint: number; outPoint: number; speed: number }): clip is Clip {
  return (
    !!clip &&
    clip.kind === 'media' &&
    clip.reverse &&
    clip.reverseProxy?.status === 'pending' &&
    closeEnough(clip.reverseProxy.inPoint, target.inPoint) &&
    closeEnough(clip.reverseProxy.outPoint, target.outPoint) &&
    closeEnough(clip.reverseProxy.speed, target.speed)
  )
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
    | 'reverse'
    | 'mirror'
  >
>

export class EditorManager {
  constructor(private readonly projectManager: ProjectManager) {}

  // Notified whenever a reverse-proxy render finishes in the background
  // (i.e. outside of any IPC call the renderer itself is awaiting) — see
  // finishReverseProxy(). main.ts wires this to a webContents.send so the
  // renderer knows to re-fetch the timeline and pick up the pending → ready/
  // error transition.
  private onChange: ((projectId: string) => void) | null = null
  /** Clip ids with a reverse-proxy render currently running — guards against kicking off a second one for the same clip while one's already in flight. */
  private readonly proxyRendersInFlight = new Set<string>()

  setChangeListener(listener: (projectId: string) => void): void {
    this.onChange = listener
  }

  async getTimeline(projectId: string): Promise<Timeline> {
    const dir = await requireProjectDir(projectId)
    const timeline = await this.readTimeline(dir)
    this.recoverOrphanedProxies(projectId, timeline)
    return timeline
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

    const removedProxyPaths = timeline.clips
      .filter((c) => c.trackId === trackId && c.reverseProxy?.relPath)
      .map((c) => c.reverseProxy!.relPath as string)

    timeline.tracks = timeline.tracks.filter((t) => t.id !== trackId)
    timeline.clips = timeline.clips.filter((c) => c.trackId !== trackId)
    renumberTrackType(timeline.tracks, track.type)

    await this.writeTimeline(dir, timeline)
    for (const relPath of removedProxyPaths) await this.deleteProxyFile(dir, relPath)
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
        reverse: false,
        mirror: false,
        reverseProxy: null,
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
        reverse: false,
        mirror: false,
        reverseProxy: null,
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
    if (updates.crop !== undefined) {
      // Guard against a degenerate crop rect (zero/negative size, e.g. from
      // an over-eager drag on the preview's crop handles) — FFmpeg's `crop`
      // filter rejects those outright and fails the whole export.
      clip.crop = updates.crop
        ? { ...updates.crop, width: Math.max(2, updates.crop.width), height: Math.max(2, updates.crop.height) }
        : null
    }
    if (updates.transform !== undefined) clip.transform = updates.transform
    if (updates.chromaKey !== undefined) {
      // FFmpeg's `chromakey` filter rejects `similarity` outside 1e-5..1
      // outright (failing the whole export), and `blend` outside 0..1 is
      // undefined behavior — clamp here the same way speed/volume are
      // clamped above, rather than trusting whatever the Clip Inspector's
      // plain number input sent.
      clip.chromaKey = {
        ...updates.chromaKey,
        similarity: Math.min(1, Math.max(0.0001, updates.chromaKey.similarity)),
        blend: Math.min(1, Math.max(0, updates.chromaKey.blend)),
      }
    }
    if (updates.transitionOut !== undefined) clip.transitionOut = updates.transitionOut
    if (updates.text !== undefined && clip.kind === 'text') clip.text = updates.text
    if (updates.reverse !== undefined && clip.kind === 'media') clip.reverse = updates.reverse
    if (updates.mirror !== undefined && clip.kind === 'media') clip.mirror = updates.mirror

    // Whatever combination of the above just changed reverse itself and/or
    // the trim/speed a reversed clip's proxy was rendered for — reconcile
    // once, after every field is already applied to `clip`, so e.g. trimming
    // an already-reversed clip in one call correctly regenerates rather than
    // silently keeping a now-stale proxy.
    const plan = this.planReverseProxyChange(clip)

    await this.writeTimeline(dir, timeline)
    await touchProject(dir)
    // Awaited (unlike the fire-and-forget kickOffGenerate below) — deleting
    // one small file is fast, and callers/tests checking "is the old proxy
    // really gone" right after this resolves shouldn't have to race it.
    if (plan.staleRelPath) await this.deleteProxyFile(dir, plan.staleRelPath)
    if (plan.generate) this.kickOffGenerate(projectId, clip.id, plan.generate)
    return timeline
  }

  async deleteClip(projectId: string, clipId: string): Promise<Timeline> {
    const dir = await requireProjectDir(projectId)
    const timeline = await this.readTimeline(dir)
    const clip = timeline.clips.find((c) => c.id === clipId)
    if (!clip) throw new Error('Clip not found.')
    const relPath = clip.reverseProxy?.relPath ?? null
    timeline.clips = timeline.clips.filter((c) => c.id !== clipId)
    await this.writeTimeline(dir, timeline)
    await touchProject(dir)
    if (relPath) await this.deleteProxyFile(dir, relPath)
    return timeline
  }

  /** Copies a clip onto the same track, placed immediately after its own tail — for the clip's right-click "Duplicate" action. */
  async duplicateClip(projectId: string, clipId: string): Promise<Timeline> {
    const dir = await requireProjectDir(projectId)
    const timeline = await this.readTimeline(dir)
    const clip = timeline.clips.find((c) => c.id === clipId)
    if (!clip) throw new Error('Clip not found.')
    const copy: Clip = {
      ...clip,
      id: randomUUID(),
      startTime: clip.startTime + clip.duration,
      // A duplicate lands right after the original with nothing following it
      // yet, so it can't inherit a transition into a clip that isn't there.
      transitionOut: { ...DEFAULT_TRANSITION, type: 'none' },
      // Never share a cached proxy *file* between two clips — the original
      // and the copy have independent lifetimes (deleting one must not break
      // the other's preview), so a duplicate always gets its own, freshly
      // generated if it needs one.
      reverseProxy: null,
    }
    const plan = this.planReverseProxyChange(copy)
    timeline.clips.push(copy)
    await this.writeTimeline(dir, timeline)
    await touchProject(dir)
    if (plan.generate) this.kickOffGenerate(projectId, copy.id, plan.generate)
    return timeline
  }

  /**
   * Detaches a media clip's audio onto its own independent clip on an audio
   * track, at the same timeline position and carrying over the source
   * clip's current trim/speed (so the two start out in sync) — then turns
   * off the source clip's own "include this clip's audio" so the sound
   * isn't doubled. The new clip references the *same* asset (no new file is
   * extracted, unlike `ProjectManager.extractAudioAsset` — the export's
   * audio chain already reads directly from whichever asset a clip points
   * at regardless of what kind of track it's on, so a second on-disk copy
   * isn't needed here).
   */
  async extractClipAudio(projectId: string, clipId: string): Promise<Timeline> {
    const dir = await requireProjectDir(projectId)
    const timeline = await this.readTimeline(dir)
    const clip = timeline.clips.find((c) => c.id === clipId)
    if (!clip) throw new Error('Clip not found.')
    if (clip.kind !== 'media' || !clip.assetId) throw new Error('Only a media clip can have its audio extracted.')

    const asset = (await this.projectManager.listAssets(projectId)).find((a) => a.id === clip.assetId)
    if (!asset) throw new Error('Asset not found.')
    const absPath = await this.projectManager.getAssetAbsolutePath(projectId, asset.id)
    const info = await probeMedia(absPath).catch(() => null)
    if (!info?.hasAudio) throw new Error('This clip has no audio track to extract.')

    // Reuse an audio track with nothing already occupying this time range;
    // otherwise add a fresh one, same "always have somewhere to put it"
    // approach as a manual drag onto a new track.
    const overlaps = (a: Clip) => a.startTime < clip.startTime + clip.duration && clip.startTime < a.startTime + a.duration
    let targetTrack = trackTypeOrders(timeline.tracks, 'audio').find(
      (t) => !timeline.clips.some((c) => c.trackId === t.id && overlaps(c)),
    )
    if (!targetTrack) {
      const siblingCount = trackTypeOrders(timeline.tracks, 'audio').length
      targetTrack = { id: randomUUID(), type: 'audio', name: `Audio ${siblingCount + 1}`, order: siblingCount, muted: false, hidden: false }
      timeline.tracks.push(targetTrack)
    }

    const { width, height } = timeline.projectSettings
    const audioClip: Clip = {
      id: randomUUID(),
      trackId: targetTrack.id,
      kind: 'media',
      assetId: clip.assetId,
      startTime: clip.startTime,
      duration: clip.duration,
      inPoint: clip.inPoint,
      outPoint: clip.outPoint,
      speed: clip.speed,
      volume: clip.volume,
      includeAudio: true,
      fadeInDuration: 0,
      fadeOutDuration: 0,
      sourceWidth: null,
      sourceHeight: null,
      crop: null,
      transform: containTransform(width, height, null, null),
      chromaKey: { ...DEFAULT_CHROMA_KEY },
      transitionOut: { ...DEFAULT_TRANSITION, type: 'none' },
      text: null,
      reverse: clip.reverse,
      mirror: false,
      // Independent clip, independent proxy (same reasoning as
      // duplicateClip) — if the source clip is reversed, this new one starts
      // out reversed too and needs its own freshly-rendered proxy.
      reverseProxy: null,
    }
    const plan = this.planReverseProxyChange(audioClip)
    timeline.clips.push(audioClip)
    clip.includeAudio = false

    await this.writeTimeline(dir, timeline)
    await touchProject(dir)
    if (plan.generate) this.kickOffGenerate(projectId, audioClip.id, plan.generate)
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

    // Both halves now cover a different, narrower trim range than whatever
    // proxy (if any) was rendered for the whole original clip — reconcile
    // each independently rather than leaving either with a proxy that no
    // longer matches its own trim.
    const headPlan = this.planReverseProxyChange(head)
    const tailPlan = this.planReverseProxyChange(clip)

    timeline.clips.push(head)
    await this.writeTimeline(dir, timeline)
    await touchProject(dir)
    if (headPlan.staleRelPath) await this.deleteProxyFile(dir, headPlan.staleRelPath)
    if (tailPlan.staleRelPath) await this.deleteProxyFile(dir, tailPlan.staleRelPath)
    if (headPlan.generate) this.kickOffGenerate(projectId, head.id, headPlan.generate)
    if (tailPlan.generate) this.kickOffGenerate(projectId, clip.id, tailPlan.generate)
    return timeline
  }

  // --- Media playback (renderer preview) -------------------------------------

  /** A `media://` URL the renderer can set directly as a `<video>`/`<audio>`/`<img>` src. */
  async getAssetMediaUrl(projectId: string, assetId: string): Promise<string> {
    const absPath = await this.projectManager.getAssetAbsolutePath(projectId, assetId)
    return buildMediaUrl(absPath)
  }

  // --- Reverse live-preview proxies -----------------------------------------
  //
  // A clip's `reverse` flips it in the *export* (real FFmpeg `reverse`/
  // `areverse`), but the live preview can't play an HTML5 <video>/<audio>
  // backwards — so PreviewPlayer.tsx instead plays a small pre-rendered
  // "reversed" proxy file forward whenever one is ready. This section is
  // what keeps each reversed clip's `reverseProxy` state (see
  // ReverseProxyState in editorTypes.ts) in sync with its current trim, and
  // what actually kicks off/cleans up the FFmpeg render (reverseProxyManager.ts
  // does the rendering itself). Every mutation method above that can change a
  // clip's `reverse`/inPoint/outPoint/speed, or remove a clip/track entirely,
  // calls into this rather than duplicating the same reconcile-then-render-
  // then-persist dance inline.

  /**
   * Decides what (if anything) needs to happen to `clip`'s reverseProxy given
   * its *current* (already-updated) reverse/inPoint/outPoint/speed — and, if
   * it decides a (re)generate is needed, immediately sets `clip.reverseProxy`
   * to a 'pending' placeholder so the caller's very next `writeTimeline`
   * persists that right away (the renderer sees "generating…" the moment its
   * own update call resolves, not only once the later change-listener fires).
   * Does not touch the filesystem or kick off any async work itself — the
   * caller decides when (after its own writeTimeline) via the returned plan.
   */
  private planReverseProxyChange(clip: Clip): {
    staleRelPath: string | null
    generate: { inPoint: number; outPoint: number; speed: number } | null
  } {
    if (clip.kind !== 'media') return { staleRelPath: null, generate: null }

    if (!clip.reverse) {
      const staleRelPath = clip.reverseProxy?.relPath ?? null
      clip.reverseProxy = null
      return { staleRelPath, generate: null }
    }

    const current = clip.reverseProxy
    const stillMatches =
      current &&
      current.status !== 'error' &&
      closeEnough(current.inPoint, clip.inPoint) &&
      closeEnough(current.outPoint, clip.outPoint) &&
      closeEnough(current.speed, clip.speed)
    if (stillMatches) return { staleRelPath: null, generate: null }

    const staleRelPath = current?.relPath ?? null
    const target = { inPoint: clip.inPoint, outPoint: clip.outPoint, speed: clip.speed }
    clip.reverseProxy = { status: 'pending', relPath: null, ...target, error: null }
    return { staleRelPath, generate: target }
  }

  private kickOffGenerate(projectId: string, clipId: string, target: { inPoint: number; outPoint: number; speed: number }): void {
    if (this.proxyRendersInFlight.has(clipId)) return
    this.proxyRendersInFlight.add(clipId)
    this.generateReverseProxy(projectId, clipId, target)
      .catch(() => {
        // generateReverseProxy already persists an 'error' status on
        // failure via finishReverseProxy — nothing further to do here, this
        // catch just exists so a rejected promise from a fire-and-forget
        // call never surfaces as an unhandled rejection.
      })
      .finally(() => this.proxyRendersInFlight.delete(clipId))
  }

  /** On every `getTimeline`, re-kicks any clip stuck 'pending' with nothing actually in flight for it — the only way that can happen is the app having restarted mid-render (the in-memory promise is gone, but the persisted 'pending' state survived), so this is what makes a reversed clip's preview self-heal after a restart instead of staying "generating…" forever. */
  private recoverOrphanedProxies(projectId: string, timeline: Timeline): void {
    for (const clip of timeline.clips) {
      if (
        clip.kind === 'media' &&
        clip.reverse &&
        clip.reverseProxy?.status === 'pending' &&
        !this.proxyRendersInFlight.has(clip.id)
      ) {
        const { inPoint, outPoint, speed } = clip.reverseProxy
        this.kickOffGenerate(projectId, clip.id, { inPoint, outPoint, speed })
      }
    }
  }

  /**
   * Renders the actual proxy file for `clipId`'s `target` trim/speed and
   * persists the result — always ending in either a 'ready' or 'error'
   * `reverseProxy` (never leaving it stuck 'pending'). Runs fully detached
   * from whatever IPC call triggered it (updateClip etc. have already
   * returned by the time this finishes), so completion is reported via
   * `onChange` instead of a return value.
   */
  private async generateReverseProxy(
    projectId: string,
    clipId: string,
    target: { inPoint: number; outPoint: number; speed: number },
  ): Promise<void> {
    const dir = await requireProjectDir(projectId)

    // Re-read fresh rather than trusting a snapshot from whenever this was
    // kicked off — an edit (or several) may have landed while this was
    // queued behind another in-flight render for the same clip.
    const timeline = await this.readTimeline(dir)
    const clip = timeline.clips.find((c) => c.id === clipId)
    if (!isPendingFor(clip, target)) return // superseded already — whoever superseded it owns the work now

    try {
      const asset = (await this.projectManager.listAssets(projectId)).find((a) => a.id === clip.assetId)
      if (!asset) throw new Error('Asset not found.')

      if (asset.kind === 'image') {
        // Reverse is a no-op on a still frame — nothing to render, just mark
        // it "ready" (with no file) so the UI stops showing "generating…".
        await this.finishReverseProxy(projectId, clipId, target, { status: 'ready', relPath: null, error: null })
        return
      }

      const absPath = await this.projectManager.getAssetAbsolutePath(projectId, asset.id)
      const info = await probeMedia(absPath)

      const proxiesDir = path.join(dir, 'editor', 'proxies')
      await fs.mkdir(proxiesDir, { recursive: true })
      const fileName = `${clipId}-${randomUUID().slice(0, 8)}.mp4`
      const outputPath = path.join(proxiesDir, fileName)

      await renderReverseProxy(
        { absPath, inPoint: target.inPoint, outPoint: target.outPoint, speed: target.speed, hasVideo: info.hasVideo, hasAudio: info.hasAudio },
        outputPath,
      )

      const relPath = path.join('editor', 'proxies', fileName)
      await this.finishReverseProxy(projectId, clipId, target, { status: 'ready', relPath, error: null })
    } catch (err) {
      await this.finishReverseProxy(projectId, clipId, target, {
        status: 'error',
        relPath: null,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  /** Persists a finished (ready/error) render — but only if it's still wanted: discards (deletes the file, leaves state untouched) if the clip was deleted, reverse got turned back off, or a newer edit already superseded this exact render while it was running. */
  private async finishReverseProxy(
    projectId: string,
    clipId: string,
    target: { inPoint: number; outPoint: number; speed: number },
    result: { status: 'ready' | 'error'; relPath: string | null; error: string | null },
  ): Promise<void> {
    const dir = await requireProjectDir(projectId)
    const timeline = await this.readTimeline(dir)
    const clip = timeline.clips.find((c) => c.id === clipId)

    if (!clip || !clip.reverse || !isPendingFor(clip, target)) {
      if (result.relPath) await this.deleteProxyFile(dir, result.relPath)
      return
    }

    clip.reverseProxy = { status: result.status, relPath: result.relPath, ...target, error: result.error }
    await this.writeTimeline(dir, timeline)
    this.onChange?.(projectId)
  }

  private async deleteProxyFile(dir: string, relPath: string): Promise<void> {
    await fs.rm(path.join(dir, relPath), { force: true }).catch(() => {
      // Best-effort cleanup — a proxy file that's already gone (or never
      // existed, e.g. an image clip's null relPath never reaches here) isn't
      // worth failing the caller's own operation over.
    })
  }

  /** The `media://` URL for a clip's *current* reverse proxy, or null if it isn't ready (or doesn't have one) — PreviewPlayer.tsx calls this instead of getAssetMediaUrl whenever a clip's reverse is on. */
  async getReverseProxyMediaUrl(projectId: string, clipId: string): Promise<string | null> {
    const dir = await requireProjectDir(projectId)
    const timeline = await this.readTimeline(dir)
    const clip = timeline.clips.find((c) => c.id === clipId)
    if (!clip?.reverseProxy || clip.reverseProxy.status !== 'ready' || !clip.reverseProxy.relPath) return null
    return buildMediaUrl(path.join(dir, clip.reverseProxy.relPath))
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
