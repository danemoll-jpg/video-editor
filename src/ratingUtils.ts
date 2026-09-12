import type { PromptRating } from '../electron/promptLabManager'

export interface ScoreAverages {
  perDimension: Record<string, number | null>
  overall: number | null
}

/**
 * Mean score per dimension across a prompt entry's per-clip ratings, plus
 * an overall mean across every scored dimension in every rating. A
 * dimension nobody has scored yet is `null`, not 0 — an unrated dimension
 * shouldn't drag the average down.
 */
export function averageScores(ratings: PromptRating[], dimensionKeys: string[]): ScoreAverages {
  const perDimension: Record<string, number | null> = {}
  const allValues: number[] = []
  for (const key of dimensionKeys) {
    const values = ratings.map((r) => r.scores[key]).filter((v): v is number => typeof v === 'number')
    perDimension[key] = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null
    allValues.push(...values)
  }
  const overall = allValues.length ? allValues.reduce((a, b) => a + b, 0) / allValues.length : null
  return { perDimension, overall }
}
