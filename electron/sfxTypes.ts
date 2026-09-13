// Deliberately has zero Node/Electron imports: it's pure data, so it's safe
// for the renderer to import directly (same pattern as
// electron/promptLabTypes.ts — see that file's header comment).
//
// As of the Phase 5 SFX merge (see electron/sfxLibraryManager.ts's header
// comment), the SFX library and the old ElevenLabs prompt-lab kind are one
// system: every entry has a `source` — a free/licensed download or an
// ElevenLabs generation — and every entry, regardless of source, gets the
// same prompt/search-term field, version history, ratings, and
// recipe-promotion. The rating dimensions below are the old ElevenLabs Lab's
// four dimensions, now applied to every SFX entry rather than just
// AI-generated ones.

export type SfxSource = 'licensed' | 'elevenlabs'

export const SFX_SOURCE_LABELS: Record<SfxSource, string> = {
  licensed: 'Free / Licensed',
  elevenlabs: 'ElevenLabs (generated)',
}

/** Placeholder copy for the generic "Prompt / search term" field, per source. */
export const SFX_PROMPT_PLACEHOLDER: Record<SfxSource, string> = {
  licensed: 'Search term used to find this on a free SFX site (optional but worth tracking)…',
  elevenlabs: 'Sound-effect description to paste into ElevenLabs…',
}

export interface SfxRatingDimension {
  key: string
  label: string
}

/** Rated dimensions, each scored 1-5 on a clip/take — applies to every entry regardless of source. */
export const SFX_RATING_DIMENSIONS: SfxRatingDimension[] = [
  { key: 'realism', label: 'Realism' },
  { key: 'timingSync', label: 'Timing / Sync' },
  { key: 'audioQuality', label: 'Audio Quality' },
  { key: 'promptObedience', label: 'Prompt Obedience' },
]
