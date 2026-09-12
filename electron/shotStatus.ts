// Deliberately has zero Node/Electron imports: it's pure data, so it's safe
// for the renderer to import directly (via src/api.d.ts) for building status
// dropdowns/labels, without pulling any main-process filesystem code into
// the browser bundle.

export type ShotStatus = 'planned' | 'prompt-ready' | 'generated' | 'imported' | 'edited' | 'complete'

/** The fixed production sequence a shot moves through, in order. */
export const SHOT_STATUSES: ShotStatus[] = [
  'planned',
  'prompt-ready',
  'generated',
  'imported',
  'edited',
  'complete',
]

export const SHOT_STATUS_LABELS: Record<ShotStatus, string> = {
  planned: 'Planned',
  'prompt-ready': 'Prompt Ready',
  generated: 'Generated',
  imported: 'Imported',
  edited: 'Edited',
  complete: 'Complete',
}
