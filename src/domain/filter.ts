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
 * What a recommendation praises a place for, across all sources. Kept apart on purpose:
 * "günstig" is not "schäbig", and many who write "ranzig" or "Absteige" are looking for
 * exactly that. The Absteige tag itself stays manual (SPEC 5.5).
 */
export const TIP_KINDS = ['urig', 'rau', 'guenstig', 'bier', 'alternativ', 'atzig'] as const
export type TipKind = (typeof TIP_KINDS)[number]

export const TIP_KIND_LABEL: Record<TipKind, string> = {
  urig: 'urig & klassisch',
  rau: 'rau & kultig',
  guenstig: 'günstig',
  bier: 'gutes Bier',
  alternativ: 'alternativ & studentisch',
  atzig: 'Party & laut',
}

// Kinds of the older lists (Falter, 1000things, offbeat) mapped onto the shared ones.
const LEGACY_KIND: Record<string, TipKind> = { beisl: 'urig', tschocherl: 'urig', kultig: 'rau', bier: 'bier' }

type Tip = NonNullable<Bar['tips']>[number]

export function tipKind(t: Tip): TipKind | null {
  if (!t.kind) return null
  if ((TIP_KINDS as readonly string[]).includes(t.kind)) return t.kind as TipKind
  return LEGACY_KIND[t.kind] ?? null
}

/** Forum tips can be single mentions; press and magazine tips always count. */
export function isStrong(t: Tip): boolean {
  return t.strength !== 'erwähnt'
}

export function strongTips(bar: Bar): Tip[] {
  return (bar.tips ?? []).filter(isStrong)
}

export function tipKinds(bar: Bar, includeWeak: boolean): Set<TipKind> {
  return new Set((bar.tips ?? []).filter((t) => includeWeak || isStrong(t)).map(tipKind).filter((k): k is TipKind => !!k))
}

/** "r/wien · rau & kultig", "Falter Lokalführer: Biertrinken". Strength stays in the background. */
export function tipLabel(t: Tip): string {
  if (sourceKind(t.source) !== 'forum') return t.source
  const k = tipKind(t)
  return k ? `${t.source} · ${TIP_KIND_LABEL[k]}` : t.source
}

/** Kind of a tip source, from its name, e.g. "Falter Lokalführer: Biertrinken". */
export function sourceKind(source: string): SourceKind {
  const s = source.toLowerCase()
  if (s.includes('falter') || s.includes('standard') || s.includes('presse')) return 'presse'
  if (s.startsWith('r/') || s.includes('reddit') || s.includes('forum')) return 'forum'
  return 'magazin'
}

export function barSources(bar: Bar, includeWeak = false): Set<SourceKind> {
  const out = new Set<SourceKind>((bar.tips ?? []).filter((t) => includeWeak || isStrong(t)).map((t) => sourceKind(t.source)))
  if (bar.official.length) out.add('offiziell')
  return out
}

export interface MapFilter {
  venueTypes: Set<VenueType>
  /** Bars must have all of these tags. */
  tags: Set<Tag>
  /** Bars must be recommended by at least one of these; empty = no filter. */
  sources: Set<SourceKind>
  /** Bars must be recommended as one of these; empty = no filter. */
  tipKinds: Set<TipKind>
  /** Also count single forum mentions; only applies while the forum source is selected. */
  weakTips: boolean
  /** Hide bars known to be closed at this minute of the week; null = no filter. */
  openAt: number | null
  /** With openAt: also keep bars whose hours are unknown (about a third of them). */
  includeUnknownHours: boolean
}

/** Single mentions count only while "Foren" is chosen as source. */
export function includeWeak(f: MapFilter): boolean {
  return f.weakTips && f.sources.has('forum')
}

export function matchesFilter(bar: Bar, f: MapFilter): boolean {
  if (!f.venueTypes.has(bar.venueType)) return false
  const weak = includeWeak(f)
  for (const t of f.tags) if (!bar.tags.includes(t)) return false
  if (f.sources.size) {
    const s = barSources(bar, weak)
    if (![...f.sources].some((k) => s.has(k))) return false
  }
  if (f.tipKinds.size) {
    const k = tipKinds(bar, weak)
    if (![...f.tipKinds].some((x) => k.has(x))) return false
  }
  if (f.openAt !== null) {
    const open = isOpenAt(bar.weeklyOpen, f.openAt)
    if (open === false || (open === null && !f.includeUnknownHours)) return false
  }
  return true
}

/** Number of active filter conditions, for the badge on the button. */
export function activeFilters(f: MapFilter, allTypes: number): number {
  return (f.venueTypes.size < allTypes ? 1 : 0) + f.tags.size + f.sources.size + f.tipKinds.size + (includeWeak(f) ? 1 : 0) + (f.openAt !== null ? 1 : 0)
}
