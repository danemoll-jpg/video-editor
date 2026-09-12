import { useEffect, useState } from 'react'
import type { ProjectSummary } from '../api'
import { formatDate } from '../format'

interface Props {
  onOpenProject: (id: string) => void
}

export default function ProjectList({ onOpenProject }: Props) {
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showNewProjectForm, setShowNewProjectForm] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const [creating, setCreating] = useState(false)

  async function refresh() {
    setLoading(true)
    try {
      setProjects(await window.api.listProjects())
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  async function handleCreate() {
    if (!newProjectName.trim() || creating) return
    setCreating(true)
    try {
      const project = await window.api.createProject(newProjectName)
      setNewProjectName('')
      setShowNewProjectForm(false)
      await refresh()
      onOpenProject(project.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="project-list">
      <div className="project-list__toolbar">
        <h2>Projects</h2>
        {!showNewProjectForm && (
          <button className="btn btn--primary" onClick={() => setShowNewProjectForm(true)}>
            + New Project
          </button>
        )}
      </div>

      {showNewProjectForm && (
        <div className="new-project-form">
          <input
            autoFocus
            type="text"
            placeholder="Project name, e.g. Abi & Dan – Forest Story"
            value={newProjectName}
            onChange={(e) => setNewProjectName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreate()
              if (e.key === 'Escape') setShowNewProjectForm(false)
            }}
          />
          <button className="btn btn--primary" disabled={creating} onClick={handleCreate}>
            {creating ? 'Creating…' : 'Create'}
          </button>
          <button className="btn" onClick={() => setShowNewProjectForm(false)}>
            Cancel
          </button>
        </div>
      )}

      {error && <div className="error-banner">{error}</div>}

      {loading ? (
        <p className="muted">Loading projects…</p>
      ) : projects.length === 0 ? (
        <p className="muted">
          No projects yet. Create your first one to get started — Dan Video Studio will set up
          its folder structure for you automatically.
        </p>
      ) : (
        <div className="project-grid">
          {projects.map((project) => (
            <button
              key={project.id}
              className="project-card"
              onClick={() => onOpenProject(project.id)}
            >
              <div className="project-card__name">{project.name}</div>
              <div className="project-card__meta">
                {project.assetCount} asset{project.assetCount === 1 ? '' : 's'}
              </div>
              <div className="project-card__meta">Updated {formatDate(project.updatedAt)}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
