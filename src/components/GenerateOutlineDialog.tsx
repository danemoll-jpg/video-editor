import { useEffect, useState } from 'react'
import type { GeneratedSceneOutline } from '../api'

interface Props {
  projectId: string
  scriptText: string
  onClose: () => void
}

type Step =
  | { kind: 'checking' }
  | { kind: 'confirm'; existingSceneCount: number; existingShotCount: number }
  | { kind: 'generating' }
  | { kind: 'done'; sceneCount: number; shotCount: number }
  | { kind: 'error'; message: string }

/**
 * The "Generate Scenes & Shots" flow (Script tab, 2026-09-14): checks
 * whether the project already has scenes and, if so, asks the user to
 * choose add-vs-replace before doing anything (per TODO.md's explicit
 * "ask before replacing, offer both real choices" requirement) — then calls
 * the Anthropic API via `window.api.generateSceneOutline` and applies the
 * result via `window.api.applyGeneratedOutline`. A replace backs up the
 * existing scenes/shots on the main-process side
 * (`ProductionManager.applyGeneratedOutline`) before overwriting anything.
 */
export default function GenerateOutlineDialog({ projectId, scriptText, onClose }: Props) {
  const [step, setStep] = useState<Step>({ kind: 'checking' })

  useEffect(() => {
    let cancelled = false
    Promise.all([window.api.listScenes(projectId), window.api.listShots(projectId)])
      .then(([scenes, shots]) => {
        if (cancelled) return
        setStep({ kind: 'confirm', existingSceneCount: scenes.length, existingShotCount: shots.length })
      })
      .catch((err) => {
        if (!cancelled) setStep({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
      })
    return () => {
      cancelled = true
    }
  }, [projectId])

  async function generate(mode: 'add' | 'replace') {
    setStep({ kind: 'generating' })
    try {
      const outline: GeneratedSceneOutline[] = await window.api.generateSceneOutline(projectId, scriptText)
      await window.api.applyGeneratedOutline(projectId, outline, mode)
      const sceneCount = outline.length
      const shotCount = outline.reduce((sum, s) => sum + s.shots.length, 0)
      setStep({ kind: 'done', sceneCount, shotCount })
    } catch (err) {
      setStep({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }

  const scriptEmpty = !scriptText.trim()

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h3>Generate Scenes & Shots</h3>
          <button className="btn" onClick={onClose}>
            ×
          </button>
        </div>

        {step.kind === 'checking' && <p className="muted">Checking this project's existing scenes…</p>}

        {step.kind === 'confirm' && scriptEmpty && (
          <>
            <p className="error-banner">Write a script first — there's nothing to generate scenes from.</p>
            <div className="modal__actions">
              <button className="btn" onClick={onClose}>
                Close
              </button>
            </div>
          </>
        )}

        {step.kind === 'confirm' && !scriptEmpty && step.existingSceneCount === 0 && (
          <>
            <p>
              This sends your script to the Anthropic API (real per-use cost, same key as the rest of the
              AI Assistant) and generates a first-pass breakdown: scenes, and shots within each scene —
              titles and descriptions only, no Grok prompt text. Everything it creates is a regular
              scene/shot afterward — editable, reorderable, and deletable in the Scenes & Shots tab like
              any other.
            </p>
            <div className="modal__actions">
              <button className="btn" onClick={onClose}>
                Cancel
              </button>
              <button className="btn btn--primary" onClick={() => generate('add')}>
                Generate
              </button>
            </div>
          </>
        )}

        {step.kind === 'confirm' && !scriptEmpty && step.existingSceneCount > 0 && (
          <>
            <p>
              This project already has {step.existingSceneCount} scene{step.existingSceneCount === 1 ? '' : 's'}
              {' '}({step.existingShotCount} shot{step.existingShotCount === 1 ? '' : 's'}). What would you like
              to do with the newly generated scenes?
            </p>
            <div className="modal__actions">
              <button className="btn" onClick={onClose}>
                Cancel
              </button>
              <button className="btn" onClick={() => generate('add')}>
                Add Alongside Existing
              </button>
              <button className="btn btn--danger" onClick={() => generate('replace')}>
                Replace Existing
              </button>
            </div>
            <p className="muted">
              Replace backs up the existing scenes and shots to a timestamped folder inside this project
              first (visible via "Open Folder") — they won't be silently lost.
            </p>
          </>
        )}

        {step.kind === 'generating' && (
          <p className="muted">Generating scenes & shots — calling the Anthropic API, this may take a moment…</p>
        )}

        {step.kind === 'done' && (
          <>
            <p>
              ✅ Generated {step.sceneCount} scene{step.sceneCount === 1 ? '' : 's'} and {step.shotCount} shot
              {step.shotCount === 1 ? '' : 's'}. Check them out in the Scenes & Shots tab.
            </p>
            <div className="modal__actions">
              <button className="btn btn--primary" onClick={onClose}>
                Close
              </button>
            </div>
          </>
        )}

        {step.kind === 'error' && (
          <>
            <div className="error-banner">{step.message}</div>
            <div className="modal__actions">
              <button className="btn" onClick={onClose}>
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
