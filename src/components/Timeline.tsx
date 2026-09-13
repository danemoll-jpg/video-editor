import { useRef } from 'react'
import type { Clip, Timeline as TimelineData, Track, TrackType } from '../api'

// The multi-track editing surface: a time ruler, one lane per track (video
// tracks, then audio tracks, then overlay/text tracks — grouped by type so
// Dan can tell at a glance which lane does what), clips as draggable/
// trimmable blocks, and a playhead line. Kept to plain mouse events (no drag
// library) — a clip drag moves it in time (and optionally to a different
// same-type track by dropping on that track's lane); dragging a clip's left/
// right edge trims it instead of moving it.

const MIN_PX_PER_SECOND = 20
const MAX_PX_PER_SECOND = 300
const TRACK_HEIGHT = 56
const EDGE_HANDLE_WIDTH = 8

interface Props {
  timeline: TimelineData
  selectedClipId: string | null
  playhead: number
  pxPerSecond: number
  onZoomChange: (px: number) => void
  onSeek: (time: number) => void
  onSelectClip: (clipId: string | null) => void
  /** Called continuously while dragging, for instant local visual feedback — no backend write. */
  onPreviewMove: (clipId: string, newStartTime: number, newTrackId: string) => void
  /** Called once when the drag ends — this is what actually persists. */
  onCommitMove: (clipId: string, newStartTime: number, newTrackId: string) => void
  onPreviewTrim: (clipId: string, edge: 'start' | 'end', newTime: number) => void
  onCommitTrim: (clipId: string, edge: 'start' | 'end', newTime: number) => void
  onAddTrack: (type: TrackType) => void
  onUpdateTrack: (trackId: string, updates: { name?: string; muted?: boolean; hidden?: boolean }) => void
  onDeleteTrack: (trackId: string) => void
  assetLabel: (clip: Clip) => string
}

function trackGroupLabel(type: TrackType): string {
  return type === 'video' ? 'Video Tracks' : type === 'audio' ? 'Audio Tracks' : 'Overlay / Text Tracks'
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toFixed(1).padStart(4, '0')}`
}

export default function Timeline({
  timeline,
  selectedClipId,
  playhead,
  pxPerSecond,
  onZoomChange,
  onSeek,
  onSelectClip,
  onPreviewMove,
  onCommitMove,
  onPreviewTrim,
  onCommitTrim,
  onAddTrack,
  onUpdateTrack,
  onDeleteTrack,
  assetLabel,
}: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const totalDuration = Math.max(30, ...timeline.clips.map((c) => c.startTime + c.duration + 5))

  const groups: { type: TrackType; tracks: Track[] }[] = (['video', 'audio', 'overlay'] as TrackType[]).map((type) => ({
    type,
    tracks: [...timeline.tracks.filter((t) => t.type === type)].sort((a, b) => a.order - b.order),
  }))

  function handleRulerClick(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const time = Math.max(0, (e.clientX - rect.left) / pxPerSecond)
    onSeek(time)
  }

  function startDragMove(e: React.MouseEvent, clip: Clip) {
    e.stopPropagation()
    onSelectClip(clip.id)
    const startX = e.clientX
    const originalStart = clip.startTime
    const originalTrackId = clip.trackId
    const originalTrackType = timeline.tracks.find((t) => t.id === originalTrackId)?.type
    const trackEls = Array.from(document.querySelectorAll<HTMLElement>('[data-track-lane]'))

    let lastStart = originalStart
    let lastTrackId = originalTrackId

    function onMove(ev: MouseEvent) {
      const dx = ev.clientX - startX
      const deltaSeconds = dx / pxPerSecond
      const newStart = Math.max(0, originalStart + deltaSeconds)

      let newTrackId = originalTrackId
      const under = trackEls.find((el) => {
        const r = el.getBoundingClientRect()
        return ev.clientY >= r.top && ev.clientY <= r.bottom
      })
      if (under && under.dataset.trackType === originalTrackType) {
        newTrackId = under.dataset.trackLane as string
      }
      lastStart = newStart
      lastTrackId = newTrackId
      onPreviewMove(clip.id, newStart, newTrackId)
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      onCommitMove(clip.id, lastStart, lastTrackId)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  function startDragTrim(e: React.MouseEvent, clip: Clip, edge: 'start' | 'end') {
    e.stopPropagation()
    onSelectClip(clip.id)
    const startX = e.clientX
    let lastTime = edge === 'start' ? clip.startTime : clip.startTime + clip.duration

    function onMove(ev: MouseEvent) {
      const dx = ev.clientX - startX
      const deltaSeconds = dx / pxPerSecond
      lastTime = edge === 'start' ? clip.startTime + deltaSeconds : clip.startTime + clip.duration + deltaSeconds
      onPreviewTrim(clip.id, edge, lastTime)
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      onCommitTrim(clip.id, edge, lastTime)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    <div className="timeline">
      <div className="timeline__toolbar">
        <span className="muted">Zoom</span>
        <input
          type="range"
          min={MIN_PX_PER_SECOND}
          max={MAX_PX_PER_SECOND}
          value={pxPerSecond}
          onChange={(e) => onZoomChange(Number(e.target.value))}
        />
        <div className="spacer" />
        <button className="btn" onClick={() => onAddTrack('video')}>
          + Video Track
        </button>
        <button className="btn" onClick={() => onAddTrack('audio')}>
          + Audio Track
        </button>
        <button className="btn" onClick={() => onAddTrack('overlay')}>
          + Overlay Track
        </button>
      </div>

      <div className="timeline__scroll" ref={scrollRef} onClick={() => onSelectClip(null)}>
        <div className="timeline__ruler" style={{ width: totalDuration * pxPerSecond }} onClick={handleRulerClick}>
          {Array.from({ length: Math.ceil(totalDuration) + 1 }).map((_, s) =>
            s % 1 === 0 ? (
              <div key={s} className="timeline__tick" style={{ left: s * pxPerSecond }}>
                {s % 5 === 0 && <span>{formatTime(s)}</span>}
              </div>
            ) : null,
          )}
          <div className="timeline__playhead" style={{ left: playhead * pxPerSecond }} />
        </div>

        {groups.map(
          (group) =>
            group.tracks.length > 0 && (
              <div key={group.type} className="timeline__group">
                <div className="timeline__group-label">{trackGroupLabel(group.type)}</div>
                {group.tracks.map((track) => (
                  <div key={track.id} className="timeline__row">
                    <div className="timeline__track-header">
                      <input
                        className="timeline__track-name"
                        value={track.name}
                        onChange={(e) => onUpdateTrack(track.id, { name: e.target.value })}
                      />
                      <button
                        className={`timeline__track-btn ${track.muted ? 'timeline__track-btn--active' : ''}`}
                        title={track.type === 'audio' ? 'Mute' : 'Mute clip audio'}
                        onClick={() => onUpdateTrack(track.id, { muted: !track.muted })}
                      >
                        {track.muted ? '🔇' : '🔊'}
                      </button>
                      {(track.type === 'video' || track.type === 'overlay') && (
                        <button
                          className={`timeline__track-btn ${track.hidden ? 'timeline__track-btn--active' : ''}`}
                          title="Hide"
                          onClick={() => onUpdateTrack(track.id, { hidden: !track.hidden })}
                        >
                          {track.hidden ? '🙈' : '👁'}
                        </button>
                      )}
                      <button
                        className="timeline__track-btn"
                        title="Delete track"
                        onClick={() => onDeleteTrack(track.id)}
                      >
                        🗑
                      </button>
                    </div>
                    <div
                      className="timeline__lane"
                      data-track-lane={track.id}
                      data-track-type={track.type}
                      style={{ width: totalDuration * pxPerSecond, height: TRACK_HEIGHT }}
                    >
                      {timeline.clips
                        .filter((c) => c.trackId === track.id)
                        .map((clip) => (
                          <div
                            key={clip.id}
                            className={`timeline__clip timeline__clip--${clip.kind} ${
                              selectedClipId === clip.id ? 'timeline__clip--selected' : ''
                            } ${clip.chromaKey.enabled ? 'timeline__clip--chroma' : ''}`}
                            style={{ left: clip.startTime * pxPerSecond, width: Math.max(4, clip.duration * pxPerSecond) }}
                            onMouseDown={(e) => startDragMove(e, clip)}
                            onClick={(e) => e.stopPropagation()}
                            title={assetLabel(clip)}
                          >
                            <div
                              className="timeline__clip-edge timeline__clip-edge--start"
                              style={{ width: EDGE_HANDLE_WIDTH }}
                              onMouseDown={(e) => startDragTrim(e, clip, 'start')}
                            />
                            <span className="timeline__clip-label">{assetLabel(clip)}</span>
                            {clip.transitionOut.type !== 'none' && <span className="timeline__clip-transition">⇥</span>}
                            <div
                              className="timeline__clip-edge timeline__clip-edge--end"
                              style={{ width: EDGE_HANDLE_WIDTH }}
                              onMouseDown={(e) => startDragTrim(e, clip, 'end')}
                            />
                          </div>
                        ))}
                    </div>
                  </div>
                ))}
              </div>
            ),
        )}
      </div>
    </div>
  )
}
