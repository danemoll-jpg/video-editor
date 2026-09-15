import { useEffect, useState } from 'react'
import type { Asset, AssetKind, ProjectSummary } from '../api'
import { formatBytes, formatDate } from '../format'
import IdeaEditor from './IdeaEditor'
import StyleEditor from './StyleEditor'
import ScriptEditor from './ScriptEditor'
import SceneList from './SceneList'
import PromptLab, { type SubTab as PromptFocusKind } from './PromptLab'
import MediaLibrary from './MediaLibrary'
import EditorView from './EditorView'

interface Props {
  projectId: string
  onBack: () => void
}

const KIND_LABELS: Record<AssetKind, string> = {
  video: 'Video',
  image: 'Image',
  audio: 'Audio',
  other: 'Other',
}

const KIND_ORDER: AssetKind[] = ['video', 'image', 'audio', 'other']

type Tab = 'assets' | 'idea' | 'style' | 'script' | 'scenes' | 'promptlab' | 'media' | 'editor'

export default function ProjectView({ projectId, onBack }: Props) {
  const [project, setProject] = useState<ProjectSummary | null>(null)
  const [assets, setAssets] = useState<Asset[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [extractingAudioId, setExtractingAudioId] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('assets')
  // "Draft Prompt" navigation (2026-09-14: Grok; extended to Suno and SFX
  // for Phase 8): which Prompt Lab sub-tab and entry a shot/scene
  // navigation should land on, expanded and ready. Cleared whenever the
  // user leaves the Prompt Lab tab, so a later *manual* visit to Prompt Lab
  // doesn't re-trigger an old navigation's auto-expand/auto-scroll.
  const [promptLabFocusKind, setPromptLabFocusKind] = useState<PromptFocusKind | null>(null)
  const [promptLabFocusEntryId, setPromptLabFocusEntryId] = useState<string | null>(null)
  // Which entry (if any) that sub-tab's AI Assistant's *next* reply should
  // auto-insert into, instead of requiring a manual "Insert" click — armed
  // only on a fresh draft-request navigation (a brand-new entry, its draft
  // request just placed unsent into the composer by `SceneList`), never on
  // a plain re-navigate to an already-linked Grok entry. Cleared the same
  // way as the focus id above, plus as soon as the auto-insert actually
  // fires (`handleAutoInsertConsumed`).
  const [promptLabAutoInsertEntryId, setPromptLabAutoInsertEntryId] = useState<string | null>(null)

  useEffect(() => {
    if (tab !== 'promptlab') {
      setPromptLabFocusKind(null)
      setPromptLabFocusEntryId(null)
      setPromptLabAutoInsertEntryId(null)
    }
  }, [tab])

  function handleOpenPromptEntry(kind: PromptFocusKind, entryId: string, armAutoInsert: boolean) {
    setPromptLabFocusKind(kind)
    setPromptLabFocusEntryId(entryId)
    setPromptLabAutoInsertEntryId(armAutoInsert ? entryId : null)
    setTab('promptlab')
  }

  function handleAutoInsertConsumed() {
    setPromptLabAutoInsertEntryId(null)
  }

  async function refresh() {
    setLoading(true)
    try {
      const [p, a] = await Promise.all([
        window.api.getProject(projectId),
        window.api.listAssets(projectId),
      ])
      setProject(p)
      setAssets(a)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  async function handleImport() {
    setImporting(true)
    try {
      setAssets(await window.api.importAssets(projectId))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setImporting(false)
    }
  }

  async function handleDeleteAsset(assetId: string) {
    try {
      setAssets(await window.api.deleteAsset(projectId, assetId))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleExtractAudio(assetId: string) {
    setExtractingAudioId(assetId)
    try {
      setAssets(await window.api.extractAudioAsset(projectId, assetId))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setExtractingAudioId(null)
    }
  }

  async function handleDeleteProject() {
    if (!project) return
    const confirmed = window.confirm(
      `Move "${project.name}" to the trash? This can be recovered from your OS trash/recycle bin.`,
    )
    if (!confirmed) return
    try {
      await window.api.deleteProject(projectId)
      onBack()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  if (loading) return <p className="muted">Loading project…</p>
  if (!project) return <p className="error-banner">Project not found.</p>

  return (
    <div className="project-view">
      <div className="project-view__toolbar">
        <button className="btn" onClick={onBack}>
          ← Back
        </button>
        <h2>{project.name}</h2>
        <div className="spacer" />
        <button className="btn" onClick={() => window.api.openProjectFolder(projectId)}>
          Open Folder
        </button>
        <button className="btn btn--danger" onClick={handleDeleteProject}>
          Delete Project
        </button>
      </div>

      <p className="project-view__path" title={project.path}>
        {project.path}
      </p>

      {error && <div className="error-banner">{error}</div>}

      <div className="tab-bar">
        <button
          className={`tab-bar__tab ${tab === 'assets' ? 'tab-bar__tab--active' : ''}`}
          onClick={() => setTab('assets')}
        >
          Assets
        </button>
        <button
          className={`tab-bar__tab ${tab === 'idea' ? 'tab-bar__tab--active' : ''}`}
          onClick={() => setTab('idea')}
        >
          Idea
        </button>
        <button
          className={`tab-bar__tab ${tab === 'style' ? 'tab-bar__tab--active' : ''}`}
          onClick={() => setTab('style')}
        >
          Style
        </button>
        <button
          className={`tab-bar__tab ${tab === 'script' ? 'tab-bar__tab--active' : ''}`}
          onClick={() => setTab('script')}
        >
          Script
        </button>
        <button
          className={`tab-bar__tab ${tab === 'scenes' ? 'tab-bar__tab--active' : ''}`}
          onClick={() => setTab('scenes')}
        >
          Scenes & Shots
        </button>
        <button
          className={`tab-bar__tab ${tab === 'promptlab' ? 'tab-bar__tab--active' : ''}`}
          onClick={() => setTab('promptlab')}
        >
          Prompt Lab
        </button>
        <button
          className={`tab-bar__tab ${tab === 'media' ? 'tab-bar__tab--active' : ''}`}
          onClick={() => setTab('media')}
        >
          Media Library
        </button>
        <button
          className={`tab-bar__tab ${tab === 'editor' ? 'tab-bar__tab--active' : ''}`}
          onClick={() => setTab('editor')}
        >
          Editor
        </button>
      </div>

      {tab === 'assets' && (
        <div className="tab-panel">
          <div className="tab-panel__toolbar">
            <div className="spacer" />
            <button className="btn btn--primary" disabled={importing} onClick={handleImport}>
              {importing ? 'Importing…' : '+ Import Assets'}
            </button>
          </div>

          {assets.length === 0 ? (
            <p className="muted">
              No assets yet. Click "Import Assets" to bring in video, image, or audio files —
              they'll be organized automatically by type.
            </p>
          ) : (
            KIND_ORDER.map((kind) => {
              const kindAssets = assets.filter((a) => a.kind === kind)
              if (kindAssets.length === 0) return null
              return (
                <section key={kind} className="asset-section">
                  <h3>
                    {KIND_LABELS[kind]} <span className="muted">({kindAssets.length})</span>
                  </h3>
                  <div className="asset-grid">
                    {kindAssets.map((asset) => (
                      <div key={asset.id} className="asset-card">
                        <div className="asset-card__name" title={asset.originalName}>
                          {asset.originalName}
                        </div>
                        <div className="asset-card__meta">{formatBytes(asset.sizeBytes)}</div>
                        <div className="asset-card__meta">{formatDate(asset.importedAt)}</div>
                        {asset.kind === 'video' && (
                          <button
                            className="asset-card__action"
                            title="Extract this video's audio into a new standalone audio asset"
                            disabled={extractingAudioId === asset.id}
                            onClick={() => handleExtractAudio(asset.id)}
                          >
                            {extractingAudioId === asset.id ? '🎵 Extracting…' : '🎵 Extract Audio'}
                          </button>
                        )}
                        <button
                          className="asset-card__delete"
                          title="Delete asset"
                          onClick={() => handleDeleteAsset(asset.id)}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
              )
            })
          )}
        </div>
      )}

      {tab === 'idea' && (
        <div className="tab-panel">
          <IdeaEditor projectId={projectId} />
        </div>
      )}

      {tab === 'style' && (
        <div className="tab-panel">
          <StyleEditor projectId={projectId} />
        </div>
      )}

      {tab === 'script' && (
        <div className="tab-panel">
          <ScriptEditor projectId={projectId} />
        </div>
      )}

      {tab === 'scenes' && (
        <div className="tab-panel">
          <SceneList projectId={projectId} assets={assets} onOpenPromptEntry={handleOpenPromptEntry} />
        </div>
      )}

      {tab === 'promptlab' && (
        <div className="tab-panel">
          <PromptLab
            projectId={projectId}
            assets={assets}
            focusKind={promptLabFocusKind}
            focusEntryId={promptLabFocusEntryId}
            autoInsertEntryId={promptLabAutoInsertEntryId}
            onAutoInsertConsumed={handleAutoInsertConsumed}
          />
        </div>
      )}

      {tab === 'media' && (
        <div className="tab-panel">
          <MediaLibrary projectId={projectId} />
        </div>
      )}

      {tab === 'editor' && (
        <div className="tab-panel">
          <EditorView projectId={projectId} projectName={project.name} assets={assets} />
        </div>
      )}
    </div>
  )
}
