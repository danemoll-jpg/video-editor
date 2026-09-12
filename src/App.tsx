import { useState } from 'react'
import ProjectList from './components/ProjectList'
import ProjectView from './components/ProjectView'

export default function App() {
  const [openProjectId, setOpenProjectId] = useState<string | null>(null)

  return (
    <div className="app">
      <header className="app-header">
        <h1>Dan Video Studio</h1>
        <span className="app-header__phase">Phase 1 — foundation</span>
      </header>

      <main className="app-main">
        {openProjectId ? (
          <ProjectView projectId={openProjectId} onBack={() => setOpenProjectId(null)} />
        ) : (
          <ProjectList onOpenProject={setOpenProjectId} />
        )}
      </main>
    </div>
  )
}
