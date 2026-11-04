// Recommendations from SPEC section 8. Standalone so a later bar guide can reuse it
// without the one-bar-per-district rule (SPEC 8.4). No paid boosts in the score.

import { isOpenAt } from './hours'
import { leg, legLabel, legMinutes, type Leg, type Matrices } from './travel'
import { TAG_LABEL, type Bar, type Participant, type Tag, type VenueType } from './types'

export interface Constraints {
  /** Districts that already have a stop; their bars are not recommended. */
  blockedDistricts: Set<number>
  /** Districts in the plan; null = all. */
  includedDistricts: Set<number> | null
  venueTypes: Set<VenueType>
  /** Edition to filter by, e.g. "2026-10"; null = no filter. */
  officialEdition: string | null
  excludedBars: Set<string>
  /** Minute of the week when the group leaves `from`; null = don't check opening hours. */
  departureMinuteOfWeek: number | null
  walkToleranceMinutes: number
}

export interface Preferences {
  participants: Participant[]
  similarity: 'similar' | 'different' | 'ignore'
  /** "Schneller ↔ Passender" slider, 0..1; 0.5 gives the starting weights. */
  speedVsMatch: number
}

export interface Recommendation {
  bar: Bar
  score: number
  leg: Leg
  closeness: number
  tourFit: number
  match: number
  similarity: number
  reasons: string[]
}

/** Starting weights w1..w4 (SPEC 8.2), with the slider moving weight between w1 + w2 and w3. */
export function weights(p: Preferences): [number, number, number, number] {
  const s = Math.min(1, Math.max(0, p.speedVsMatch))
  const w3 = s <= 0.5 ? 0.4 * s : 0.2 + (s - 0.5) * 1.0
  const travel = 0.9 - w3
  const w4 = p.similarity === 'ignore' ? 0 : 0.1
  return [(travel * 4) / 7, (travel * 3) / 7, w3, w4]
}

export function closeness(minutes: number): number {
  return 1 - Math.min(minutes, 45) / 45
}

/** Mean over participants, each in -1..1. No participants give 0; an untagged bar
 *  only scores on venue type (from the taste finder), otherwise 0. */
export function match(bar: Bar, participants: Participant[]): number {
  if (participants.length === 0) return 0
  let sum = 0
  for (const p of participants) {
    const liked = p.likedTypes ?? []
    const avoided = p.avoidedTypes ?? []
    const likes = p.likes.filter((t) => bar.tags.includes(t)).length + (liked.includes(bar.venueType) ? 1 : 0)
    const avoids = p.avoids.filter((t) => bar.tags.includes(t)).length + (avoided.includes(bar.venueType) ? 1 : 0)
    const n = (bar.tags.length ? p.likes.length + p.avoids.length : 0) + (liked.length || avoided.length ? 1 : 0)
    if (n === 0) continue
    const raw = (likes - 1.5 * avoids) / Math.max(1, n)
    sum += Math.min(1, Math.max(-1, raw))
  }
  return sum / participants.length
}

export function jaccard(a: Tag[], b: Tag[]): number {
  const union = new Set([...a, ...b])
  if (union.size === 0) return 0
  return a.filter((t) => b.includes(t)).length / union.size
}

function similarityScore(u: Bar, v: Bar, mode: Preferences['similarity']): number {
  if (mode === 'ignore') return 0
  // Untagged bars are neutral (SPEC 2).
  if (u.tags.length === 0 || v.tags.length === 0) return 0.5
  const j = jaccard(u.tags, v.tags)
  return mode === 'similar' ? j : 1 - j
}

export function passesFilters(bar: Bar, c: Constraints): boolean {
  if (c.blockedDistricts.has(bar.district)) return false
  if (c.includedDistricts && !c.includedDistricts.has(bar.district)) return false
  if (!c.venueTypes.has(bar.venueType)) return false
  if (c.officialEdition && !bar.official.includes(c.officialEdition)) return false
  return !c.excludedBars.has(bar.id)
}

export function recommend(
  from: Bar,
  bars: Bar[],
  matrices: Matrices,
  constraints: Constraints,
  preferences: Preferences,
  limit = 20,
): Recommendation[] {
  const [w1, w2, w3, w4] = weights(preferences)
  const likes = new Set(preferences.participants.flatMap((p) => p.likes))
  const out: Recommendation[] = []
  for (const bar of bars) {
    if (bar.id === from.id || !passesFilters(bar, constraints)) continue
    const l = leg(matrices, from.matrixIndex, bar.matrixIndex, constraints.walkToleranceMinutes)
    const minutes = legMinutes(l)
    if (!Number.isFinite(minutes)) continue
    // Not known to be closed on arrival; unknown hours are allowed (SPEC 8.1).
    if (constraints.departureMinuteOfWeek !== null
      && isOpenAt(bar.weeklyOpen, constraints.departureMinuteOfWeek + minutes) === false) continue
    const c = closeness(minutes)
    const tourFit = 0.5 // Instant stage (SPEC 8.3); refined by the solver in Phase 5.
    const m = match(bar, preferences.participants)
    const s = similarityScore(from, bar, preferences.similarity)
    const reasons = [legLabel(l)]
    for (const t of bar.tags) if (likes.has(t)) reasons.push(TAG_LABEL[t])
    if (preferences.similarity === 'similar' && reasons.length === 1) {
      for (const t of bar.tags) if (from.tags.includes(t)) reasons.push(TAG_LABEL[t])
    }
    out.push({
      bar, leg: l, closeness: c, tourFit, match: m, similarity: s, reasons: reasons.slice(0, 4),
      score: w1 * c + w2 * tourFit + w3 * m + w4 * s,
    })
  }
  out.sort((a, b) => b.score - a.score || legMinutes(a.leg) - legMinutes(b.leg))
  return out.slice(0, limit)
}
