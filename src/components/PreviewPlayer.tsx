import { useEffect, useRef } from 'react'
import type { AssetKind, Clip, Timeline, Track } from '../api'

// The live preview compositor — draws every visible frame onto one <canvas>,
// approximating the same layering rules videoExportManager.ts uses for the
// real export (video tracks bottom-to-top by order, then overlay/text tracks
// on top of all of them), so what Dan sees while editing is a close
// approximation of the exported result. It is deliberately NOT pixel-exact —
// two known simplifications, both called out in TODO.md:
//   1. Transitions preview as a hard cut to the later clip rather than an
//      actual crossfade/wipe (the real blend only happens in the FFmpeg
//      export, which is the authoritative renderer — see videoExportManager.ts).
//   2. Chroma-key pixel processing needs `canvas.getImageData`, which throws
//      if the browser considers the canvas "tainted"; caught below, in which
//      case that one clip just previews unkeyed (still keyed correctly in
//      the actual export).
//
// While playing, this component owns the advancing playhead itself (driven
// by requestAnimationFrame + wall-clock delta, not by the underlying video
// elements' own clocks) and reports it upward via `onTimeUpdate` so
// Timeline.tsx's playhead line stays in sync — while paused/scrubbing, the
// parent's `playhead` prop is the single source of truth and this component
// just draws whatever frame that time corresponds to.

interface Props {
  projectId: string
  timeline: Timeline
  playhead: number
  isPlaying: boolean
  assetKindById: Record<string, AssetKind>
  onTimeUpdate: (time: number) => void
  onEnded: () => void
}

interface Pool {
  video: Map<string, HTMLVideoElement>
  audio: Map<string, HTMLAudioElement>
  image: Map<string, HTMLImageElement>
  urlCache: Map<string, string>
  offscreen: HTMLCanvasElement
}

function sortByOrder(tracks: Track[]): Track[] {
  return [...tracks].sort((a, b) => a.order - b.order)
}

function fadeAlpha(localTime: number, duration: number, fadeIn: number, fadeOut: number): number {
  let alpha = 1
  if (fadeIn > 0 && localTime < fadeIn) alpha = Math.min(alpha, localTime / fadeIn)
  const outStart = duration - fadeOut
  if (fadeOut > 0 && localTime > outStart) alpha = Math.min(alpha, (duration - localTime) / fadeOut)
  return Math.max(0, Math.min(1, alpha))
}

/** The active clip on a track at `time`, if any — the *later*-starting one wins during a transition overlap. */
function activeClip(clips: Clip[], trackId: string, time: number): Clip | null {
  const candidates = clips.filter((c) => c.trackId === trackId && time >= c.startTime && time < c.startTime + c.duration)
  if (candidates.length === 0) return null
  return candidates.reduce((latest, c) => (c.startTime > latest.startTime ? c : latest))
}

export default function PreviewPlayer({
  projectId,
  timeline,
  playhead,
  isPlaying,
  assetKindById,
  onTimeUpdate,
  onEnded,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const poolRef = useRef<Pool>({
    video: new Map(),
    audio: new Map(),
    image: new Map(),
    urlCache: new Map(),
    offscreen: document.createElement('canvas'),
  })
  const rafRef = useRef<number | null>(null)
  const lastWallClockRef = useRef<number | null>(null)
  const playTimeRef = useRef(playhead)

  const timelineRef = useRef(timeline)
  const isPlayingRef = useRef(isPlaying)
  const assetKindRef = useRef(assetKindById)
  const onTimeUpdateRef = useRef(onTimeUpdate)
  const onEndedRef = useRef(onEnded)
  timelineRef.current = timeline
  isPlayingRef.current = isPlaying
  assetKindRef.current = assetKindById
  onTimeUpdateRef.current = onTimeUpdate
  onEndedRef.current = onEnded

  // When playback starts, seed the internal play clock from wherever the
  // (parent-controlled) playhead currently is; while paused, always draw
  // exactly the parent's playhead.
  useEffect(() => {
    if (isPlaying) {
      playTimeRef.current = playhead
      lastWallClockRef.current = null
    } else {
      draw(playhead)
      syncAudioAndPlayback(playhead, false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying])

  useEffect(() => {
    if (!isPlaying) draw(playhead)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playhead, timeline])

  async function getMediaUrl(assetId: string): Promise<string> {
    const pool = poolRef.current
    const cached = pool.urlCache.get(assetId)
    if (cached) return cached
    const url = await window.api.getAssetMediaUrl(projectId, assetId)
    pool.urlCache.set(assetId, url)
    return url
  }

  function getVideoEl(clip: Clip): HTMLVideoElement {
    const pool = poolRef.current
    let el = pool.video.get(clip.id)
    if (!el) {
      el = document.createElement('video')
      el.crossOrigin = 'anonymous'
      el.playsInline = true
      pool.video.set(clip.id, el)
      if (clip.assetId) getMediaUrl(clip.assetId).then((url) => (el!.src = url))
    }
    return el
  }

  function getAudioEl(clip: Clip): HTMLAudioElement {
    const pool = poolRef.current
    let el = pool.audio.get(clip.id)
    if (!el) {
      el = document.createElement('audio')
      el.crossOrigin = 'anonymous'
      pool.audio.set(clip.id, el)
      if (clip.assetId) getMediaUrl(clip.assetId).then((url) => (el!.src = url))
    }
    return el
  }

  function getImageEl(clip: Clip): HTMLImageElement {
    const pool = poolRef.current
    let el = pool.image.get(clip.id)
    if (!el) {
      el = document.createElement('img')
      el.crossOrigin = 'anonymous'
      pool.image.set(clip.id, el)
      if (clip.assetId) getMediaUrl(clip.assetId).then((url) => (el!.src = url))
    }
    return el
  }

  // Prune pooled elements for clips no longer on the timeline.
  useEffect(() => {
    const pool = poolRef.current
    const liveIds = new Set(timeline.clips.map((c) => c.id))
    for (const [id, el] of pool.video) {
      if (!liveIds.has(id)) {
        el.pause()
        el.src = ''
        pool.video.delete(id)
      }
    }
    for (const [id, el] of pool.audio) {
      if (!liveIds.has(id)) {
        el.pause()
        el.src = ''
        pool.audio.delete(id)
      }
    }
    for (const id of pool.image.keys()) {
      if (!liveIds.has(id)) pool.image.delete(id)
    }
  }, [timeline.clips])

  function drawClipVisual(ctx: CanvasRenderingContext2D, clip: Clip, sourceEl: HTMLVideoElement | HTMLImageElement, alpha: number) {
    const t = clip.transform
    ctx.save()
    ctx.globalAlpha = alpha

    const doDraw = (target: CanvasImageSource) => {
      if (clip.crop) {
        ctx.drawImage(target, clip.crop.x, clip.crop.y, clip.crop.width, clip.crop.height, t.x, t.y, t.width, t.height)
      } else {
        ctx.drawImage(target, t.x, t.y, t.width, t.height)
      }
    }

    if (clip.chromaKey.enabled) {
      try {
        const off = poolRef.current.offscreen
        const sw = clip.sourceWidth || (sourceEl as HTMLVideoElement).videoWidth || t.width
        const sh = clip.sourceHeight || (sourceEl as HTMLVideoElement).videoHeight || t.height
        off.width = sw
        off.height = sh
        const octx = off.getContext('2d')!
        octx.clearRect(0, 0, sw, sh)
        octx.drawImage(sourceEl, 0, 0, sw, sh)
        const imageData = octx.getImageData(0, 0, sw, sh)
        const { color, similarity } = clip.chromaKey
        const kr = parseInt(color.slice(1, 3), 16)
        const kg = parseInt(color.slice(3, 5), 16)
        const kb = parseInt(color.slice(5, 7), 16)
        const threshold = similarity * 441.7 // similarity (0..1) scaled by the max possible RGB distance
        const d = imageData.data
        for (let i = 0; i < d.length; i += 4) {
          const dr = d[i] - kr
          const dg = d[i + 1] - kg
          const db = d[i + 2] - kb
          if (Math.sqrt(dr * dr + dg * dg + db * db) < threshold) d[i + 3] = 0
        }
        octx.putImageData(imageData, 0, 0)
        doDraw(off)
      } catch {
        // Canvas tainted (cross-origin security) — fall back to unkeyed preview.
        // The real export always applies chroma key correctly regardless.
        doDraw(sourceEl)
      }
    } else {
      doDraw(sourceEl)
    }
    ctx.restore()
  }

  function drawText(ctx: CanvasRenderingContext2D, clip: Clip, alpha: number) {
    const text = clip.text
    if (!text) return
    const t = clip.transform
    ctx.save()
    ctx.globalAlpha = alpha
    ctx.font = `${text.fontSize}px "${text.fontFamily}"`
    ctx.textBaseline = 'middle'
    const metrics = ctx.measureText(text.content)
    let x = t.x
    if (text.align === 'center') {
      ctx.textAlign = 'center'
      x = t.x + t.width / 2
    } else if (text.align === 'right') {
      ctx.textAlign = 'right'
      x = t.x + t.width - 10
    } else {
      ctx.textAlign = 'left'
      x = t.x + 10
    }
    const y = t.y + t.height / 2
    if (text.backgroundColor) {
      const boxW = metrics.width + 24
      const boxX = text.align === 'center' ? x - boxW / 2 : text.align === 'right' ? x - boxW + 10 : x - 12
      ctx.fillStyle = text.backgroundColor
      ctx.globalAlpha = alpha * 0.6
      ctx.fillRect(boxX, y - text.fontSize * 0.7, boxW, text.fontSize * 1.4)
      ctx.globalAlpha = alpha
    }
    ctx.fillStyle = text.color
    ctx.fillText(text.content, x, y)
    ctx.restore()
  }

  function draw(time: number) {
    const canvas = canvasRef.current
    if (!canvas) return
    const tl = timelineRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    if (canvas.width !== tl.projectSettings.width) canvas.width = tl.projectSettings.width
    if (canvas.height !== tl.projectSettings.height) canvas.height = tl.projectSettings.height

    ctx.fillStyle = tl.projectSettings.backgroundColor
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    const videoTracks = sortByOrder(tl.tracks.filter((t) => t.type === 'video' && !t.hidden))
    const overlayTracks = sortByOrder(tl.tracks.filter((t) => t.type === 'overlay' && !t.hidden))

    for (const track of [...videoTracks, ...overlayTracks]) {
      const clip = activeClip(tl.clips, track.id, time)
      if (!clip) continue
      const localTime = time - clip.startTime
      const alpha = fadeAlpha(localTime, clip.duration, clip.fadeInDuration, clip.fadeOutDuration)
      if (alpha <= 0) continue

      if (clip.kind === 'text') {
        drawText(ctx, clip, alpha)
        continue
      }
      if (!clip.assetId) continue
      const kind = assetKindRef.current[clip.assetId]
      if (kind === 'image') {
        const img = getImageEl(clip)
        if (img.complete && img.naturalWidth > 0) drawClipVisual(ctx, clip, img, alpha)
      } else {
        const videoEl = getVideoEl(clip)
        const desiredTime = clip.inPoint + localTime * clip.speed
        if (Number.isFinite(desiredTime) && videoEl.readyState >= 1 && Math.abs(videoEl.currentTime - desiredTime) > 0.2) {
          try {
            videoEl.currentTime = desiredTime
          } catch {
            // not seekable yet
          }
        }
        videoEl.playbackRate = clip.speed
        if (videoEl.readyState >= 2) drawClipVisual(ctx, clip, videoEl, alpha)
      }
    }
  }

  function syncAudioAndPlayback(time: number, playing: boolean) {
    const tl = timelineRef.current
    for (const clip of tl.clips) {
      if (clip.kind !== 'media' || !clip.assetId) continue
      const track = tl.tracks.find((t) => t.id === clip.trackId)
      if (!track) continue
      const kind = assetKindRef.current[clip.assetId]
      if (kind === 'image') continue

      const active = time >= clip.startTime && time < clip.startTime + clip.duration
      const localTime = time - clip.startTime
      const alpha = active ? fadeAlpha(localTime, clip.duration, clip.fadeInDuration, clip.fadeOutDuration) : 0
      const shouldSound = track.type === 'audio' ? active && !track.muted : active && !track.muted && clip.includeAudio
      const desiredTime = clip.inPoint + Math.max(0, localTime) * clip.speed

      const applyTo = (el: HTMLMediaElement) => {
        el.volume = Math.max(0, Math.min(1, clip.volume * alpha))
        el.muted = !shouldSound
        el.playbackRate = clip.speed
        if (playing && active) {
          if (el.paused) {
            try {
              el.currentTime = desiredTime
            } catch {
              /* not seekable yet */
            }
            el.play().catch(() => {})
          } else if (Math.abs(el.currentTime - desiredTime) > 0.35) {
            try {
              el.currentTime = desiredTime
            } catch {
              /* ignore */
            }
          }
        } else if (!el.paused) {
          el.pause()
        }
      }

      if (track.type === 'audio') applyTo(getAudioEl(clip))
      else if (kind === 'video') applyTo(getVideoEl(clip))
    }
  }

  // Main playback loop — only advances time / plays media while isPlaying;
  // while paused, drawing is driven entirely by the `playhead`/`timeline`
  // effect above instead.
  useEffect(() => {
    function tick(now: number) {
      if (!isPlayingRef.current) {
        rafRef.current = requestAnimationFrame(tick)
        return
      }
      const last = lastWallClockRef.current
      lastWallClockRef.current = now
      if (last !== null) playTimeRef.current += (now - last) / 1000

      const totalDuration = Math.max(0, ...timelineRef.current.clips.map((c) => c.startTime + c.duration))
      let time = playTimeRef.current
      if (time >= totalDuration) {
        time = totalDuration
        draw(time)
        onEndedRef.current()
        rafRef.current = requestAnimationFrame(tick)
        return
      }

      draw(time)
      syncAudioAndPlayback(time, true)
      onTimeUpdateRef.current(time)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="preview-player">
      <canvas
        ref={canvasRef}
        className="preview-player__canvas"
        width={timeline.projectSettings.width}
        height={timeline.projectSettings.height}
      />
    </div>
  )
}
