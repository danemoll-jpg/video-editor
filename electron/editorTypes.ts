// Deliberately has zero Node/Electron imports, same renderer-safe-import
// pattern as shotStatus.ts/promptLabTypes.ts/sfxTypes.ts: this is pure data
// (the Phase 6 timeline/clip shape plus a couple of fixed lookup tables), so
// the renderer imports it directly instead of duplicating it — see
// editorManager.ts's header comment for how this shape is stored on disk and
// videoExportManager.ts for how it's turned into an actual FFmpeg command.

export type TrackType = 'video' | 'audio' | 'overlay'

export interface Track {
  id: string
  type: TrackType
  name: string
  /** Stacking order within its type — for video/overlay tracks, higher draws on top. Contiguous 0..n-1 per type. */
  order: number
  muted: boolean
  hidden: boolean
}

/** Position/size of a clip's visible content on the project canvas, in canvas pixels. */
export interface Transform {
  x: number
  y: number
  width: number
  height: number
  rotation: number
}

/** A crop rectangle in the *source* media's own pixel coordinates, applied before `Transform`. */
export interface Crop {
  x: number
  y: number
  width: number
  height: number
}

export interface ChromaKey {
  enabled: boolean
  /** #rrggbb */
  color: string
  /** 0..1 — how close a pixel's color must be to `color` to be keyed out. */
  similarity: number
  /** 0..1 — edge softness/blend of the keyed-out region. */
  blend: number
}

export const TRANSITION_TYPES = ['none', 'fade', 'fadeblack', 'wipeleft', 'wiperight', 'dissolve'] as const
export type TransitionType = (typeof TRANSITION_TYPES)[number]

export const TRANSITION_LABELS: Record<TransitionType, string> = {
  none: 'None',
  fade: 'Cross Dissolve',
  fadeblack: 'Fade to Black',
  wipeleft: 'Wipe Left',
  wiperight: 'Wipe Right',
  dissolve: 'Dissolve',
}

/** A transition out of this clip into whatever clip immediately follows it on the same track. */
export interface Transition {
  type: TransitionType
  /** Seconds — how long the two clips overlap. Ignored when type is 'none'. */
  duration: number
}

export type ReverseProxyStatus = 'pending' | 'ready' | 'error'

/**
 * Cache state for a media clip's reverse live-preview proxy (see
 * reverseProxyManager.ts for how one is actually rendered and
 * editorManager.ts for when) — browsers can't play an HTML5 `<video>`/
 * `<audio>` backwards (no negative playbackRate), so a clip with `reverse`
 * on gets its currently-trimmed range pre-rendered, reversed, into a small
 * cached file, and the live preview plays *that* forward instead. `null`
 * whenever `reverse` is off (or has never been turned on) — a clip only
 * carries this while its reversed preview is pending/ready/failed.
 */
export interface ReverseProxyState {
  status: ReverseProxyStatus
  /** Project-relative path under `editor/proxies/` once `status` is 'ready' — null while pending, on error, or for an image clip (reverse is a no-op on a still frame, so no file is ever rendered). */
  relPath: string | null
  /** The trim/speed the current (or in-progress) file was rendered for — compared against the clip's live inPoint/outPoint/speed to detect a stale proxy after a trim/speed change. */
  inPoint: number
  outPoint: number
  speed: number
  error: string | null
}

export type ClipKind = 'media' | 'text'

export interface TextStyle {
  content: string
  fontFamily: string
  fontSize: number
  /** #rrggbb */
  color: string
  align: 'left' | 'center' | 'right'
  /** #rrggbb, or null for no background box behind the text. */
  backgroundColor: string | null
}

export interface Clip {
  id: string
  trackId: string
  kind: ClipKind
  /** Asset id (projectManager.ts) this clip plays — null for text clips. */
  assetId: string | null
  /** Position on the timeline, seconds. */
  startTime: number
  /** On-timeline (post-speed) duration, seconds. */
  duration: number
  /** Source trim-in, seconds of source time (pre-speed). Media clips only. */
  inPoint: number
  /** Source trim-out, seconds of source time (pre-speed). Media clips only. */
  outPoint: number
  /** Playback speed multiplier — 1 = normal. Media clips only. */
  speed: number
  /** 0..2 — audio gain. Applies to a media clip's own audio (if any). */
  volume: number
  /** Whether a video-track media clip's own audio is included in the export mix. */
  includeAudio: boolean
  fadeInDuration: number
  fadeOutDuration: number
  /** Native pixel size of the source (probed via FFprobe when the clip was added). Null for text clips. */
  sourceWidth: number | null
  sourceHeight: number | null
  /** Null = use the full source frame (no crop). In source pixel units — see Crop. */
  crop: Crop | null
  transform: Transform
  chromaKey: ChromaKey
  transitionOut: Transition
  text: TextStyle | null
  /** Plays the clip's source (video and its own audio, if included) backwards. Media clips only. */
  reverse: boolean
  /** Flips the clip horizontally (mirror image). Media clips only. */
  mirror: boolean
  /** Reverse live-preview proxy cache state — see ReverseProxyState. Null unless/until `reverse` has been turned on. */
  reverseProxy: ReverseProxyState | null
}

export interface ProjectSettings {
  width: number
  height: number
  fps: number
  /** #rrggbb — shows through wherever no video/overlay track has content. */
  backgroundColor: string
}

export interface Timeline {
  projectSettings: ProjectSettings
  tracks: Track[]
  clips: Clip[]
}

export const DEFAULT_PROJECT_SETTINGS: ProjectSettings = {
  width: 1920,
  height: 1080,
  fps: 30,
  backgroundColor: '#000000',
}

/** Fits a source frame into the canvas preserving aspect ratio (letterboxed/pillarboxed, centered). */
export function containTransform(
  canvasWidth: number,
  canvasHeight: number,
  sourceWidth: number | null,
  sourceHeight: number | null,
): Transform {
  if (!sourceWidth || !sourceHeight) return { x: 0, y: 0, width: canvasWidth, height: canvasHeight, rotation: 0 }
  const scale = Math.min(canvasWidth / sourceWidth, canvasHeight / sourceHeight)
  const width = Math.round(sourceWidth * scale)
  const height = Math.round(sourceHeight * scale)
  return { x: Math.round((canvasWidth - width) / 2), y: Math.round((canvasHeight - height) / 2), width, height, rotation: 0 }
}

/** Default box a new text clip's content sits in — a lower-third-style band. */
export function defaultTextTransform(canvasWidth: number, canvasHeight: number): Transform {
  const height = Math.round(canvasHeight * 0.18)
  return { x: 0, y: Math.round(canvasHeight * 0.72), width: canvasWidth, height, rotation: 0 }
}

export const DEFAULT_CHROMA_KEY: ChromaKey = {
  enabled: false,
  color: '#00b140',
  similarity: 0.2,
  blend: 0.1,
}

export const DEFAULT_TRANSITION: Transition = { type: 'none', duration: 0.5 }

export const FONT_FAMILIES = ['Arial', 'Georgia', 'Impact', 'Courier New', 'Segoe UI', 'Verdana'] as const

export function defaultTextStyle(): TextStyle {
  return {
    content: 'Title text',
    fontFamily: 'Arial',
    fontSize: 64,
    color: '#ffffff',
    align: 'center',
    backgroundColor: null,
  }
}

/** Seconds of on-timeline overlap while a transition to the next clip plays out. */
export function transitionOverlapSeconds(clip: Pick<Clip, 'transitionOut'>): number {
  return clip.transitionOut.type === 'none' ? 0 : clip.transitionOut.duration
}
