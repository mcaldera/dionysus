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
  if (f.openAt !== null && isOpenAt(bar.weeklyOpen, f.openAt) === false) return false
  return true
}

/** Number of active filter conditions, for the badge on the button. */
export function activeFilters(f: MapFilter, allTypes: number): number {
  return (f.venueTypes.size < allTypes ? 1 : 0) + f.tags.size + f.sources.size + (f.openAt !== null ? 1 : 0)
}
