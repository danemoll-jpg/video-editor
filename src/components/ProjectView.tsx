import { useEffect, useState } from 'react'
import type { Asset, AssetKind, ProjectSummary } from '../api'
import { formatBytes, formatDate } from '../format'

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

export default function ProjectView({ projectId, onBack }: Props) {
  const [project, setProject] = useState<ProjectSummary | null>(null)
  const [assets, setAssets] = useState<Asset[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)

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
        <button className="btn btn--primary" disabled={importing} onClick={handleImport}>
          {importing ? 'Importing…' : '+ Import Assets'}
        </button>
        <button className="btn btn--danger" onClick={handleDeleteProject}>
          Delete Project
        </button>
      </div>

      <p className="project-view__path" title={project.path}>
        {project.path}
      </p>

      {error && <div className="error-banner">{error}</div>}

      {assets.length === 0 ? (
        <p className="muted">
          No assets yet. Click "Import Assets" to bring in video, image, or audio files — they'll
          be organized automatically by type.
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
  )
}
