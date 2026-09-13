import { useState } from 'react'
import ProjectList from './components/ProjectList'
import ProjectView from './components/ProjectView'
import Settings from './components/Settings'

export default function App() {
  const [openProjectId, setOpenProjectId] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)

  return (
    <div className="app">
      <header className="app-header">
        <h1>Dan's Video Studio</h1>
        <span className="app-header__phase">Phase 6 — Video Editor</span>
        <div className="spacer" />
        <button className="btn" onClick={() => setShowSettings((s) => !s)}>
          {showSettings ? '← Back' : '⚙ Settings'}
        </button>
      </header>

      <main className="app-main">
        {showSettings ? (
          <Settings />
        ) : openProjectId ? (
          <ProjectView projectId={openProjectId} onBack={() => setOpenProjectId(null)} />
        ) : (
          <ProjectList onOpenProject={setOpenProjectId} />
        )}
      </main>
    </div>
  )
}
