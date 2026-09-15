import { averageScores, type Scoreable } from './ratingUtils'

/** Structural shape a PromptEntry or SfxEntry both satisfy — enough to compute "top-rated." */
export interface TechniqueEntry {
  promptText: string
  ratings: Scoreable[]
}

/** Structural shape a Recipe or SfxRecipe both satisfy. */
export interface TechniqueRecipe {
  name: string
  promptText: string
}

/**
 * Builds the "proven technique" portion of a lab's composed draft request:
 * that lab's own top-rated entries (by overall average score across every
 * rated dimension) and its promoted recipes — folded into plain, editable
 * text rather than an invisible system-prompt injection, per the "Draft
 * Prompt" pattern's review-before-send design (see SceneList.tsx's
 * handleDraftGrokPrompt/handleDraftSunoPrompt/handleDraftSfxPrompt, which all
 * call this once per newly-created entry, not on every AI Assistant
 * follow-up turn in an ongoing conversation). An entry with no ratings yet
 * (including the entry the caller just created for this very draft) simply
 * doesn't qualify as "top-rated" — `averageScores` returns `null` for it,
 * filtered out below — so this never quotes an unproven, blank draft back at
 * itself as a "top" example.
 */
export function buildTechniqueContext(
  labLabel: string,
  entries: TechniqueEntry[],
  recipes: TechniqueRecipe[],
  dimensionKeys: string[],
  topN = 3,
): string {
  const rated = entries
    .map((entry) => ({ entry, overall: averageScores(entry.ratings, dimensionKeys).overall }))
    .filter((r): r is { entry: TechniqueEntry; overall: number } => r.overall !== null)
    .sort((a, b) => b.overall - a.overall)
    .slice(0, topN)

  const blocks: string[] = []
  if (rated.length > 0) {
    blocks.push(
      `Top-rated ${labLabel} prompts from this project so far (for reference, not to copy verbatim):\n` +
        rated.map((r) => `- (${r.overall.toFixed(1)}/5) ${r.entry.promptText}`).join('\n'),
    )
  }
  if (recipes.length > 0) {
    blocks.push(
      `Saved ${labLabel} recipes (reusable wording that's worked well before):\n` +
        recipes.map((r) => `- ${r.name}: ${r.promptText}`).join('\n'),
    )
  }
  return blocks.join('\n\n')
}

/**
 * Assembles the full composed draft-request text placed unsent into a lab's
 * AI Assistant composer: any context blocks (Style notes, technique context
 * — empty ones are dropped) followed by the actual instruction and seed.
 * Shared by all three "Draft Prompt" flows so their assembled text has one
 * consistent shape.
 */
export function assembleDraftRequest(instruction: string, seed: string, contextBlocks: string[]): string {
  const header = contextBlocks.map((b) => b.trim()).filter(Boolean).join('\n\n---\n\n')
  const body = `${instruction}\n\n${seed}`
  return header ? `${header}\n\n---\n\n${body}` : body
}
