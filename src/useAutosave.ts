import { useEffect, useRef } from 'react'

/**
 * Real debounced autosave, added 2026-09-14 to fix a real data-loss bug: Dan
 * lost typed Idea notes and an AI Assistant conversation by switching tabs
 * without clicking the (only) explicit Save button — see TODO.md's Current
 * Objective. Used by `IdeaEditor.tsx`, `ScriptEditor.tsx`, and
 * `AiAssistantPanel.tsx`'s composer draft.
 *
 * `save(value)` fires `AUTOSAVE_DELAY_MS` after `value` stops changing while
 * `shouldSave` is true — but the debounce alone doesn't fix Dan's exact
 * scenario (type, then switch tabs *immediately*, before the delay elapses):
 * switching tabs unmounts the editor, and a plain `setTimeout` scheduled in a
 * `useEffect` gets cleared by React on unmount before it can fire, discarding
 * the pending edit right along with the component. The second effect below
 * closes that gap: its cleanup runs on every unmount (including the debounce
 * timer's own component tearing down) and flushes the latest value
 * immediately if a save was still pending — `save` is an IPC call into the
 * main process, which keeps running and writes to disk regardless of whether
 * the renderer component that invoked it is still around by the time it
 * finishes (the same mechanism `aiAssistantManager.sendMessage` already
 * relied on for the sent/received side of this bug).
 */
const AUTOSAVE_DELAY_MS = 1200

export function useAutosave(value: string, shouldSave: boolean, save: (value: string) => void) {
  const valueRef = useRef(value)
  const shouldSaveRef = useRef(shouldSave)
  const saveRef = useRef(save)
  valueRef.current = value
  shouldSaveRef.current = shouldSave
  saveRef.current = save

  useEffect(() => {
    if (!shouldSave) return
    const timer = setTimeout(() => saveRef.current(valueRef.current), AUTOSAVE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [value, shouldSave])

  // Flush-on-unmount: fires once, when this component actually goes away
  // (e.g. its tab is switched away from), not on every value change.
  useEffect(() => {
    return () => {
      if (shouldSaveRef.current) saveRef.current(valueRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
