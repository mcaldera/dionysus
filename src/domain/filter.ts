// The map filter: what you see on the map and in recommendation and swap lists.
// Tour planning has its own settings (types, districts, times) and ignores this filter,
// so filtering for "Essen" while looking at one district doesn't change the whole tour.

import { isOpenAt } from './hours'
import type { Bar, Tag, VenueType } from './types'

export type SourceKind = 'presse' | 'magazin' | 'forum' | 'offiziell'

export const SOURCE_LABEL: Record<SourceKind, string> = {
  presse: 'Fachpresse (Falter)',
  magazin: 'Stadtmagazine & Blogs',
  forum: 'Foren (Reddit)',
  offiziell: 'Seidlwandertage-Partner',
}

export const SOURCE_KINDS: SourceKind[] = ['presse', 'magazin', 'forum', 'offiziell']

/**
 * What a forum post praises a place for. Kept apart on purpose: "günstig" is not "schäbig",
 * and many who write "ranzig" or "Absteige" are looking for exactly that. The Absteige tag
 * itself stays manual (SPEC 5.5); these are other people's recommendations.
 */
export const FORUM_KINDS = ['guenstig', 'urig', 'rau', 'atzig'] as const
export type ForumKind = (typeof FORUM_KINDS)[number]

export const FORUM_KIND_LABEL: Record<ForumKind, string> = {
  guenstig: 'günstig',
  urig: 'urig & klassisch',
  rau: 'rau & kultig',
  atzig: 'atzig & laut',
}

export function forumKinds(bar: Bar): Set<string> {
  return new Set((bar.tips ?? []).filter((t) => sourceKind(t.source) === 'forum' && t.kind).map((t) => t.kind!))
}

/** "r/wien: rau & kultig" for a forum tip, the source name otherwise. */
export function tipLabel(t: { source: string; kind?: string }): string {
  if (sourceKind(t.source) === 'forum' && t.kind && t.kind in FORUM_KIND_LABEL) {
    return `r/wien: ${FORUM_KIND_LABEL[t.kind as ForumKind]}`
  }
  return t.source
}

/** Kind of a tip source, from its name, e.g. "Falter Lokalführer: Biertrinken". */
export function sourceKind(source: string): SourceKind {
  const s = source.toLowerCase()
  if (s.includes('falter') || s.includes('standard') || s.includes('presse')) return 'presse'
  if (s.includes('reddit') || s.includes('forum')) return 'forum'
  return 'magazin'
}

export function barSources(bar: Bar): Set<SourceKind> {
  const out = new Set<SourceKind>((bar.tips ?? []).map((t) => sourceKind(t.source)))
  if (bar.official.length) out.add('offiziell')
  return out
}

export interface MapFilter {
  venueTypes: Set<VenueType>
  /** Bars must have all of these tags. */
  tags: Set<Tag>
  /** Bars must be recommended by at least one of these; empty = no filter. */
  sources: Set<SourceKind>
  /** Bars must have a forum mention of one of these kinds; empty = no filter. */
  forumKinds: Set<ForumKind>
  /** Hide bars known to be closed at this minute of the week; null = no filter. */
  openAt: number | null
}

export function matchesFilter(bar: Bar, f: MapFilter): boolean {
  if (!f.venueTypes.has(bar.venueType)) return false
  for (const t of f.tags) if (!bar.tags.includes(t)) return false
  if (f.sources.size) {
    const s = barSources(bar)
    if (![...f.sources].some((k) => s.has(k))) return false
  }
  if (f.forumKinds.size) {
    const k = forumKinds(bar)
    if (![...f.forumKinds].some((x) => k.has(x))) return false
  }
  if (f.openAt !== null && isOpenAt(bar.weeklyOpen, f.openAt) === false) return false
  return true
}

/** Number of active filter conditions, for the badge on the button. */
export function activeFilters(f: MapFilter, allTypes: number): number {
  return (f.venueTypes.size < allTypes ? 1 : 0) + f.tags.size + f.sources.size + f.forumKinds.size + (f.openAt !== null ? 1 : 0)
}
