import { useEffect, useMemo, useState } from 'react'
import type { Asset, Clip, ClipUpdates, Timeline as TimelineData, TrackType } from '../api'
import Timeline, { type TimeRange } from './Timeline'
import PreviewPlayer from './PreviewPlayer'
import ClipInspector from './ClipInspector'
import ExportDialog from './ExportDialog'

interface Props {
  projectId: string
  projectName: string
  assets: Asset[]
}

function computeTrimUpdate(clip: Clip, edge: 'start' | 'end', rawNewTime: number): ClipUpdates {
  if (edge === 'start') {
    const end = clip.startTime + clip.duration
    const newStart = Math.min(Math.max(0, rawNewTime), end - 0.1)
    if (clip.kind === 'text') return { startTime: newStart, duration: end - newStart }
    const newInPoint = Math.max(0, clip.inPoint + (newStart - clip.startTime) * clip.speed)
    return { startTime: newStart, inPoint: newInPoint }
  }
  const newEnd = Math.max(rawNewTime, clip.startTime + 0.1)
  const newDuration = newEnd - clip.startTime
  if (clip.kind === 'text') return { duration: newDuration }
  const newOutPoint = clip.outPoint + (newDuration - clip.duration) * clip.speed
  return { outPoint: newOutPoint }
}

export default function EditorView({ projectId, projectName, assets }: Props) {
  const [timeline, setTimeline] = useState<TimelineData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null)
  const [playhead, setPlayhead] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [pxPerSecond, setPxPerSecond] = useState(80)
  const [showExport, setShowExport] = useState(false)
  const [selection, setSelection] = useState<TimeRange | null>(null)
  const [addTrackId, setAddTrackId] = useState<string>('')
  const [addAssetId, setAddAssetId] = useState<string>('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    window.api
      .getTimeline(projectId)
      .then((tl) => {
        if (!cancelled) setTimeline(tl)
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : String(err)))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [projectId])

  // A reverse-proxy render (see editorManager.ts) finishes outside of any
  // IPC call this view itself awaited — this is what picks up that
  // pending → ready/error transition (and any other out-of-band timeline
  // change) once it happens, rather than leaving the UI showing "generating…"
  // forever until the next unrelated edit happens to re-fetch the timeline.
  useEffect(() => {
    return window.api.onTimelineUpdated((updatedProjectId) => {
      if (updatedProjectId === projectId) window.api.getTimeline(projectId).then(setTimeline).catch(() => {})
    })
  }, [projectId])

  const assetById = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets])
  const assetKindById = useMemo(() => Object.fromEntries(assets.map((a) => [a.id, a.kind])), [assets])

  function assetLabel(clip: Clip): string {
    if (clip.kind === 'text') return `📝 ${clip.text?.content.slice(0, 24) || 'Title'}`
    const asset = clip.assetId ? assetById.get(clip.assetId) : undefined
    return asset ? asset.originalName : 'Missing asset'
  }

  function updateLocalClip(clipId: string, patch: Partial<Clip>) {
    setTimeline((tl) => (tl ? { ...tl, clips: tl.clips.map((c) => (c.id === clipId ? { ...c, ...patch } : c)) } : tl))
  }

  async function refreshFrom(promise: Promise<TimelineData>) {
    try {
      const tl = await promise
      setTimeline(tl)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const selectedClip = timeline?.clips.find((c) => c.id === selectedClipId) ?? null

  if (loading) return <p className="muted">Loading editor…</p>
  if (!timeline) return <p className="error-banner">{error || 'Could not load the timeline.'}</p>

  const videoOrImageAssets = assets.filter((a) => a.kind === 'video' || a.kind === 'image')
  const audioAssets = assets.filter((a) => a.kind === 'audio')
  const selectedTrack = timeline.tracks.find((t) => t.id === addTrackId) ?? timeline.tracks[0]
  const compatibleAssets = selectedTrack?.type === 'audio' ? audioAssets : videoOrImageAssets

  async function handleAddClip() {
    if (!selectedTrack || !addAssetId) return
    await refreshFrom(
      window.api.addClip(projectId, { trackId: selectedTrack.id, assetId: addAssetId, kind: 'media', startTime: playhead }),
    )
  }

  async function handleAddText(trackId: string) {
    await refreshFrom(window.api.addClip(projectId, { trackId, assetId: null, kind: 'text', startTime: playhead }))
  }

  return (
    <div className="editor-view">
      {error && <div className="error-banner">{error}</div>}

      <div className="editor-view__main">
        <div className="editor-view__preview-col">
          <PreviewPlayer
            projectId={projectId}
            timeline={timeline}
            playhead={playhead}
            isPlaying={isPlaying}
            assetKindById={assetKindById}
            onTimeUpdate={setPlayhead}
            onEnded={() => setIsPlaying(false)}
            selectedClip={selectedClip}
            onPreviewClipEdit={(clipId, updates) => updateLocalClip(clipId, updates as Partial<Clip>)}
            onCommitClipEdit={(clipId, updates) => refreshFrom(window.api.updateClip(projectId, clipId, updates))}
          />
          <div className="editor-view__transport">
            <button className="btn" onClick={() => setPlayhead(0)}>
              ⏮
            </button>
            <button className="btn btn--primary" onClick={() => setIsPlaying((p) => !p)}>
              {isPlaying ? '⏸ Pause' : '▶ Play'}
            </button>
            <span className="muted">{playhead.toFixed(2)}s</span>
            <div className="spacer" />
            <button className="btn btn--primary" onClick={() => setShowExport(true)}>
              ⬇ Export
            </button>
          </div>

          <div className="add-clip-bar">
            <select value={selectedTrack?.id ?? ''} onChange={(e) => setAddTrackId(e.target.value)}>
              {timeline.tracks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.type})
                </option>
              ))}
            </select>
            {selectedTrack?.type === 'overlay' ? (
              <>
                <select value={addAssetId} onChange={(e) => setAddAssetId(e.target.value)}>
                  <option value="">— pick an image (optional) —</option>
                  {videoOrImageAssets
                    .filter((a) => a.kind === 'image')
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.originalName}
                      </option>
                    ))}
                </select>
                <button className="btn" disabled={!addAssetId} onClick={handleAddClip}>
                  + Add Image at Playhead
                </button>
                <button className="btn" onClick={() => handleAddText(selectedTrack.id)}>
                  + Add Text at Playhead
                </button>
              </>
            ) : (
              <>
                <select value={addAssetId} onChange={(e) => setAddAssetId(e.target.value)}>
                  <option value="">— pick an asset —</option>
                  {compatibleAssets.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.originalName}
                    </option>
                  ))}
                </select>
                <button className="btn" disabled={!addAssetId} onClick={handleAddClip}>
                  + Add at Playhead
                </button>
              </>
            )}
          </div>
        </div>

        {selectedClip && (
          <ClipInspector
            clip={selectedClip}
            playhead={playhead}
            onUpdate={(updates) => {
              updateLocalClip(selectedClip.id, updates as Partial<Clip>)
              refreshFrom(window.api.updateClip(projectId, selectedClip.id, updates))
            }}
            onDelete={() => {
              setSelectedClipId(null)
              refreshFrom(window.api.deleteClip(projectId, selectedClip.id))
            }}
            onSplit={() => refreshFrom(window.api.splitClip(projectId, selectedClip.id, playhead))}
          />
        )}
      </div>

      <Timeline
        timeline={timeline}
        selectedClipId={selectedClipId}
        playhead={playhead}
        pxPerSecond={pxPerSecond}
        onZoomChange={setPxPerSecond}
        onSeek={setPlayhead}
        onSelectClip={setSelectedClipId}
        selection={selection}
        onSelectionChange={setSelection}
        onPreviewMove={(clipId, newStartTime, newTrackId) => updateLocalClip(clipId, { startTime: newStartTime, trackId: newTrackId })}
        onCommitMove={(clipId, newStartTime, newTrackId) =>
          refreshFrom(window.api.updateClip(projectId, clipId, { startTime: newStartTime, trackId: newTrackId }))
        }
        onPreviewTrim={(clipId, edge, newTime) => {
          const clip = timeline.clips.find((c) => c.id === clipId)
          if (clip) updateLocalClip(clipId, computeTrimUpdate(clip, edge, newTime) as Partial<Clip>)
        }}
        onCommitTrim={(clipId, edge, newTime) => {
          const clip = timeline.clips.find((c) => c.id === clipId)
          if (clip) refreshFrom(window.api.updateClip(projectId, clipId, computeTrimUpdate(clip, edge, newTime)))
        }}
        onAddTrack={(type: TrackType) => refreshFrom(window.api.addTrack(projectId, type))}
        onUpdateTrack={(trackId, updates) => refreshFrom(window.api.updateTrack(projectId, trackId, updates))}
        onDeleteTrack={(trackId) => {
          if (!window.confirm('Delete this track and all its clips?')) return
          refreshFrom(window.api.deleteTrack(projectId, trackId))
        }}
        onClipAction={(action, clip) => {
          if (action === 'split') refreshFrom(window.api.splitClip(projectId, clip.id, playhead))
          else if (action === 'duplicate') refreshFrom(window.api.duplicateClip(projectId, clip.id))
          else if (action === 'extractAudio') refreshFrom(window.api.extractClipAudio(projectId, clip.id))
          else if (action === 'delete') {
            if (selectedClipId === clip.id) setSelectedClipId(null)
            refreshFrom(window.api.deleteClip(projectId, clip.id))
          }
        }}
        assetLabel={assetLabel}
      />

      {showExport && (
        <ExportDialog
          projectId={projectId}
          projectName={projectName}
          timeline={timeline}
          playhead={playhead}
          selection={selection}
          onClose={() => setShowExport(false)}
        />
      )}
    </div>
  )
}
