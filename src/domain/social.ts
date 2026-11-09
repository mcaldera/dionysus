// What friends add to the site: ratings, comments and lists, and what follows from them
// (averages, rankings, filters, recommendations). The data comes from api/app.ts.

import type { Bar } from './types'

export interface Member { id: string; name: string }
export interface Me extends Member { hasPassword: boolean }
export interface Rating { barId: string; memberId: string; stars: number; at: number }
export interface Comment { id: string; barId: string; memberId: string; body: string; at: number }
export interface ListView {
  id: string
  ownerId: string
  title: string
  description: string
  updatedAt: number
  /** Private lists reach only their owner. */
  isPublic: boolean
  /** The list behind the heart: each person's "Meine Lokale". */
  isMain: boolean
  barIds: string[]
}

export interface SocialState {
  /** The profile of this browser; null if it has none. */
  me: Me | null
  members: Member[]
  ratings: Rating[]
  commentCounts: Record<string, number>
  lists: ListView[]
  recentComments: Comment[]
}

/** The signed-in person's "Meine Lokale"; null without a profile. */
export function mainListOf(state: SocialState | null): ListView | null {
  const me = state?.me
  return me ? state.lists.find((l) => l.isMain && l.ownerId === me.id) ?? null : null
}

/** Your own main list is "Meine Lokale" to you; friends see it under its title. */
export function listLabel(list: ListView, state: SocialState): string {
  return list.isMain && list.ownerId === state.me?.id ? 'Meine Lokale' : list.title
}

export interface BarStats {
  /** Average of all ratings; null if nobody rated the bar. */
  avg: number | null
  ratings: Rating[]
  comments: number
}

const NO_STATS: BarStats = { avg: null, ratings: [], comments: 0 }

export function indexByBar(state: SocialState | null): Map<string, BarStats> {
  const out = new Map<string, BarStats>()
  if (!state) return out
  const entry = (id: string) => {
    let e = out.get(id)
    if (!e) out.set(id, e = { avg: null, ratings: [], comments: 0 })
    return e
  }
  for (const r of state.ratings) entry(r.barId).ratings.push(r)
  for (const [id, n] of Object.entries(state.commentCounts)) entry(id).comments = n
  for (const e of out.values()) {
    if (e.ratings.length) e.avg = e.ratings.reduce((s, r) => s + r.stars, 0) / e.ratings.length
    e.ratings.sort((a, b) => b.stars - a.stars || b.at - a.at)
  }
  return out
}

export function statsOf(index: Map<string, BarStats>, barId: string): BarStats {
  return index.get(barId) ?? NO_STATS
}

/** "4,3": one decimal, the Austrian way. */
export function formatStars(value: number): string {
  return value.toFixed(1).replace('.', ',')
}

/** "9. Nov.", with the year only when it isn't this one. */
export function shortDate(at: number): string {
  const d = new Date(at)
  return d.toLocaleDateString('de-AT', { day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' })
}

// ---------- Filter ----------

export interface FriendFilter {
  /** Rated at least this high: by `ratedBy` if set, else on average. 0 = any rating; null = no filter. */
  minRating: number | null
  commented: boolean
  unratedByMe: boolean
  /** Rated by this member. */
  ratedBy: string | null
  /** On this list. */
  listId: string | null
}

export const NO_FRIEND_FILTER: FriendFilter = { minRating: null, commented: false, unratedByMe: false, ratedBy: null, listId: null }

export function friendFilterCount(f: FriendFilter): number {
  return (f.minRating !== null ? 1 : 0) + (f.commented ? 1 : 0) + (f.unratedByMe ? 1 : 0) + (f.ratedBy ? 1 : 0) + (f.listId ? 1 : 0)
}

/** The bars that pass; null when the filter is off. */
export function friendFilterSet(bars: Bar[], state: SocialState | null, index: Map<string, BarStats>, f: FriendFilter): Set<string> | null {
  if (!state || !friendFilterCount(f)) return null
  const list = f.listId ? new Set(state.lists.find((l) => l.id === f.listId)?.barIds ?? []) : null
  const meId = state.me?.id
  const out = new Set<string>()
  for (const b of bars) {
    const s = statsOf(index, b.id)
    if (list && !list.has(b.id)) continue
    if (f.commented && !s.comments) continue
    if (f.unratedByMe && s.ratings.some((r) => r.memberId === meId)) continue
    const by = f.ratedBy ? s.ratings.find((r) => r.memberId === f.ratedBy) : null
    if (f.ratedBy && !by) continue
    if (f.minRating !== null) {
      const value = by ? by.stars : s.avg
      if (value === null || value < f.minRating) continue
    }
    out.add(b.id)
  }
  return out
}

// ---------- Rankings ----------

export interface Ranked { bar: Bar; value: number; count: number }

/**
 * The group's best bars. The average is pulled towards 3.5 by one imaginary vote, so a single
 * five-star rating doesn't outrank a bar three friends agree on. `value` is the plain average.
 */
export function groupRanking(bars: Bar[], index: Map<string, BarStats>): Ranked[] {
  const shrunk = (s: BarStats) => (s.ratings.reduce((sum, r) => sum + r.stars, 0) + 3.5) / (s.ratings.length + 1)
  return bars.flatMap((bar) => {
    const s = statsOf(index, bar.id)
    return s.avg === null ? [] : [{ bar, value: s.avg, count: s.ratings.length, score: shrunk(s) }]
  }).sort((a, b) => b.score - a.score || b.count - a.count || a.bar.name.localeCompare(b.bar.name, 'de'))
}

/** One member's ratings, best first: everyone's automatic favourites. */
export function memberRanking(bars: Bar[], state: SocialState, memberId: string): Ranked[] {
  const byId = new Map(bars.map((b) => [b.id, b]))
  return state.ratings.filter((r) => r.memberId === memberId).flatMap((r) => {
    const bar = byId.get(r.barId)
    return bar ? [{ bar, value: r.stars, count: 1, at: r.at }] : []
  }).sort((a, b) => b.value - a.value || b.at - a.at)
}

// ---------- Taste and recommendations ----------

export interface TasteMatch {
  member: Member
  /** How close your ratings are, 0-1; meaningful only with `shared` > 0. */
  agreement: number
  shared: number
  /** Agreement pulled towards a neutral 0.6 while few bars are shared: how much this friend counts. */
  weight: number
}

/** How much each friend's taste matches mine, closest first. */
export function tasteMatches(state: SocialState): TasteMatch[] {
  const meId = state.me?.id
  const mine = new Map(state.ratings.filter((r) => r.memberId === meId).map((r) => [r.barId, r.stars]))
  return state.members.filter((m) => m.id !== meId).map((member) => {
    let shared = 0
    let distance = 0
    for (const r of state.ratings) {
      const own = r.memberId === member.id ? mine.get(r.barId) : undefined
      if (own === undefined) continue
      shared++
      distance += Math.abs(own - r.stars)
    }
    const agreement = shared ? 1 - distance / shared / 4 : 0
    return { member, agreement, shared, weight: (shared * agreement + 2 * 0.6) / (shared + 2) }
  }).sort((a, b) => b.shared && a.shared ? b.agreement - a.agreement : b.shared - a.shared)
}

function cosine(a: number[], b: number[]): number {
  let dot = 0
  let x = 0
  let y = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    x += a[i] * a[i]
    y += b[i] * b[i]
  }
  return x && y ? dot / Math.sqrt(x * y) : 0
}

// Among all pairs of bars the median similarity is about 0, the top 10 % start at 0.46, and a
// bar's nearest neighbour is typically at 0.87. Below 0.45 a similarity says nothing.
const SIMILARITY_FLOOR = 0.45
const SIMILARITY_FULL = 0.9
const SIMILAR_ENOUGH_TO_SAY = 0.6
const FRIENDS_SHARE = 0.65
const MIN_SCORE = 0.08

export interface SocialRec { bar: Bar; score: number; reason: string }

function closeness(similarity: number): number {
  return Math.min(1, Math.max(0, (similarity - SIMILARITY_FLOOR) / (SIMILARITY_FULL - SIMILARITY_FLOOR)))
}

function joinNames(names: string[]): string {
  return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} und ${names[names.length - 1]}`
}

function friendsReason(ratings: { name: string; stars: number }[]): string {
  const best = [...ratings].sort((a, b) => b.stars - a.stars)
  if (best.length === 1) return `${best[0].name} gibt ${best[0].stars} ★`
  const avg = best.reduce((s, r) => s + r.stars, 0) / best.length
  const names = best.length <= 3 ? joinNames(best.map((r) => r.name)) : `${best.length} Freunde`
  return `${names}: im Schnitt ${formatStars(avg)} ★`
}

/**
 * Bars I haven't rated, from two signals: what friends think (those who rate like me count more)
 * and how close a bar's profile is to bars I rated well (and how far from those I rated badly).
 */
export function recommendForMe(bars: Bar[], state: SocialState, limit = 30): SocialRec[] {
  const meId = state.me?.id
  if (!meId) return []
  const byId = new Map(bars.map((b) => [b.id, b]))
  const weightOf = new Map(tasteMatches(state).map((t) => [t.member.id, t]))
  const mine = state.ratings.filter((r) => r.memberId === meId)
  const rated = new Set(mine.map((r) => r.barId))
  const withVec = (stars: (s: number) => boolean) => mine.flatMap((r) => {
    const bar = byId.get(r.barId)
    return bar?.profile && stars(r.stars) ? [{ bar, vec: bar.profile.vec, stars: r.stars }] : []
  })
  const liked = withVec((s) => s >= 4)
  const disliked = withVec((s) => s <= 2)

  const friendRatings = new Map<string, Rating[]>()
  for (const r of state.ratings) {
    if (r.memberId === meId || rated.has(r.barId)) continue
    friendRatings.set(r.barId, [...(friendRatings.get(r.barId) ?? []), r])
  }

  const out: SocialRec[] = []
  for (const bar of bars) {
    if (rated.has(bar.id)) continue
    let friendScore = 0
    let reason = ''
    const ratings = friendRatings.get(bar.id) ?? []
    if (ratings.length) {
      let total = 0
      let sum = 0
      for (const r of ratings) {
        const w = weightOf.get(r.memberId)?.weight ?? 0.6
        total += w
        sum += w * r.stars
      }
      // A range from -1 to 1, kept small while only little evidence stands behind it.
      friendScore = ((sum / total - 3) / 2) * (total / (total + 1))
      reason = friendsReason(ratings.map((r) => ({ name: weightOf.get(r.memberId)?.member.name ?? '?', stars: r.stars })))
    }

    let contentScore = 0
    if (bar.profile) {
      const vec = bar.profile.vec
      let best: { name: string; stars: number; similarity: number } | null = null
      for (const l of liked) {
        const similarity = cosine(vec, l.vec)
        if (!best || similarity > best.similarity) best = { name: l.bar.name, stars: l.stars, similarity }
      }
      const against = disliked.reduce((m, d) => Math.max(m, cosine(vec, d.vec)), -1)
      contentScore = closeness(best?.similarity ?? -1) - 0.5 * closeness(against)
      if (best && best.similarity >= SIMILAR_ENOUGH_TO_SAY) {
        const similar = `ähnlich wie ${best.name} (von dir ${best.stars} ★)`
        reason = reason ? `${reason}, ${similar}` : similar[0].toUpperCase() + similar.slice(1)
      }
    }

    const score = FRIENDS_SHARE * friendScore + (1 - FRIENDS_SHARE) * contentScore
    if (score >= MIN_SCORE && reason) out.push({ bar, score, reason })
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit)
}

// ---------- Activity ----------

export type Activity =
  | { kind: 'comment'; at: number; barId: string; memberId: string; body: string }
  | { kind: 'rating'; at: number; barId: string; memberId: string; stars: number }

/** The newest comments and ratings together, newest first. */
export function recentActivity(state: SocialState, limit = 30): Activity[] {
  const items: Activity[] = [
    ...state.recentComments.map((c): Activity => ({ kind: 'comment', at: c.at, barId: c.barId, memberId: c.memberId, body: c.body })),
    ...state.ratings.map((r): Activity => ({ kind: 'rating', at: r.at, barId: r.barId, memberId: r.memberId, stars: r.stars })),
  ]
  return items.sort((a, b) => b.at - a.at).slice(0, limit)
}
