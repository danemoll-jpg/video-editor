// Deliberately has zero Node/Electron imports: it's pure data, so it's safe
// for the renderer to import directly (same pattern as electron/shotStatus.ts
// — see that file's header comment) for building lab tabs, rating forms, and
// dimension labels, without pulling any main-process filesystem code into
// the browser bundle.
//
// Grok, Suno, and ElevenLabs SFX all follow the same "prompt lab" shape
// (prompt history, per-clip ratings, version comparison, reusable recipes —
// see electron/promptLabManager.ts) but rate different things, so the rating
// dimensions are keyed by lab here rather than hard-coded into the manager.

export type PromptLabKind = 'grok' | 'suno' | 'elevenlabs'

export const PROMPT_LAB_KINDS: PromptLabKind[] = ['grok', 'suno', 'elevenlabs']

export const PROMPT_LAB_LABELS: Record<PromptLabKind, string> = {
  grok: 'Grok Prompt Lab',
  suno: 'Suno Music Lab',
  elevenlabs: 'ElevenLabs SFX Lab',
}

/** Placeholder copy for the main prompt-text field, per lab. */
export const PROMPT_LAB_PROMPT_PLACEHOLDER: Record<PromptLabKind, string> = {
  grok: 'Video generation prompt to paste into Grok…',
  suno: 'Style/genre prompt to paste into Suno…',
  elevenlabs: 'Sound-effect description to paste into ElevenLabs…',
}

export interface RatingDimension {
  key: string
  label: string
}

/** Per-lab set of rated dimensions, each scored 1-5 on a clip/generation. */
export const RATING_DIMENSIONS: Record<PromptLabKind, RatingDimension[]> = {
  grok: [
    { key: 'characterConsistency', label: 'Character Consistency' },
    { key: 'motion', label: 'Motion' },
    { key: 'cameraBehavior', label: 'Camera Behavior' },
    { key: 'promptObedience', label: 'Prompt Obedience' },
    { key: 'visualQuality', label: 'Visual Quality' },
  ],
  suno: [
    { key: 'melody', label: 'Melody / Composition' },
    { key: 'vocalsLyricsFit', label: 'Vocals & Lyrics Fit' },
    { key: 'productionQuality', label: 'Production Quality' },
    { key: 'promptObedience', label: 'Prompt Obedience' },
    { key: 'overallVibe', label: 'Overall Vibe' },
  ],
  elevenlabs: [
    { key: 'realism', label: 'Realism' },
    { key: 'timingSync', label: 'Timing / Sync' },
    { key: 'audioQuality', label: 'Audio Quality' },
    { key: 'promptObedience', label: 'Prompt Obedience' },
  ],
}

/** Whether this lab uses the lyrics field (Suno only — Grok/ElevenLabs hide it in the UI). */
export function labUsesLyrics(kind: PromptLabKind): boolean {
  return kind === 'suno'
}
