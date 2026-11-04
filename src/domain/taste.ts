// Taste finder: turn likes and dislikes of sample bars into preferences.

import { TAGS, VENUE_TYPES, type Bar, type Participant, type Tag, type VenueType } from './types'

export type Verdict = 'like' | 'dislike' | 'skip'

/** Pick n sample bars, spread over venue types, preferring bars with tags or tips. */
export function sampleBars(bars: Bar[], n: number, seed: number): Bar[] {
  let s = seed >>> 0 || 1
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32)
  const informative = bars.filter((b) => b.tags.length >= 1 || (b.tips?.length ?? 0) > 0)
  const pool = informative.length >= n * 3 ? informative : bars
  const byType = new Map<VenueType, Bar[]>()
  for (const b of pool) byType.set(b.venueType, [...(byType.get(b.venueType) ?? []), b])
  for (const list of byType.values()) list.sort(() => rand() - 0.5)
  const types = VENUE_TYPES.filter((t) => byType.get(t)?.length)
  const out: Bar[] = []
  for (let i = 0; out.length < n && i < n * 10; i++) {
    const b = byType.get(types[i % types.length])?.pop()
    if (b) out.push(b)
  }
  return out
}

/** Tags and venue types that liked bars share more often than disliked ones. */
export function preferencesFrom(verdicts: { bar: Bar; verdict: Verdict }[], name = 'Wir'): Participant {
  const tagScore = new Map<Tag, { like: number; dislike: number }>()
  const typeScore = new Map<VenueType, number>()
  for (const { bar, verdict } of verdicts) {
    if (verdict === 'skip') continue
    const d = verdict === 'like' ? 1 : -1
    for (const t of bar.tags) {
      const cur = tagScore.get(t) ?? { like: 0, dislike: 0 }
      if (d > 0) cur.like++
      else cur.dislike++
      tagScore.set(t, cur)
    }
    typeScore.set(bar.venueType, (typeScore.get(bar.venueType) ?? 0) + d)
  }
  const likes: Tag[] = []
  const avoids: Tag[] = []
  for (const t of TAGS) {
    const sc = tagScore.get(t)
    if (!sc) continue
    const net = sc.like - sc.dislike
    if (net >= 2 || (net >= 1 && sc.dislike === 0)) likes.push(t)
    else if (net <= -2 || (net <= -1 && sc.like === 0)) avoids.push(t)
  }
  const likedTypes = VENUE_TYPES.filter((t) => (typeScore.get(t) ?? 0) >= 1)
  const avoidedTypes = VENUE_TYPES.filter((t) => (typeScore.get(t) ?? 0) <= -1)
  return { name, likes, avoids, likedTypes, avoidedTypes }
}
