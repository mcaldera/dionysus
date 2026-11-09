// The Atlas: bars placed by profile similarity (pipeline/private/similarity.py writes the
// layouts, the nested territories and the profile facets to public/data/atlas.json).

import { profileCosine } from './recommend'
import type { Bar } from './types'

export type AtlasLayout = 'tsne' | 'umap' | 'pca'

export interface Territory {
  /** Short name from the local LLM, e.g. "Gemütliche Gastgärten". */
  name: string
  desc: string
  /** What sets the group apart, e.g. ["Wein", "gemütlich"]. */
  traits: string[]
  n: number
}

export interface AtlasData {
  /** Matrix index of each bar; all other arrays follow this order. */
  bars: number[]
  /** Positions 0-1 per layout; UMAP and PCA are turned to match t-SNE. */
  layouts: Record<AtlasLayout, [number, number][]>
  /** Nested clusterings, coarse to fine (Ward): cluster index per bar and the clusters. */
  levels: { k: number; assign: number[]; clusters: Territory[] }[]
  facets: {
    names: string[]
    /** Word for a high value, and for a low one (style scales only). */
    high: string[]
    low: (string | null)[]
    mean: number[]
    values: (number | null)[][]
  }
}

export const LAYOUT_LABEL: Record<AtlasLayout, { label: string; hint: string }> = {
  tsne: { label: 't-SNE', hint: 'Betont Nachbarschaften: ähnliche Lokale liegen eng beisammen, Abstände zwischen Gruppen sagen wenig' },
  umap: { label: 'UMAP', hint: 'Nachbarschaften und etwas mehr von der Gesamtstruktur' },
  pca: { label: 'PCA', hint: 'Die zwei Hauptrichtungen der Unterschiede; ehrlich, aber gedrängt' },
}

/** The five style scales, shown as sliders in the focus card. */
export const STYLE_SCALES = ['rau_schick', 'ruhig_laut', 'traditionell_modern', 'gemuetlichkeit', 'preisniveau']

/**
 * The zones of the radar, by the similarity of the compact profile vectors (cosine). Over all
 * bars the median bar has about 13 others above 0.75, 140 above 0.5, 530 above 0.2 and a good
 * half of the city below 0. The zones sit at the same radii for every bar, so one with few
 * look-alikes has a nearly empty middle. The close zones get most of the radius.
 */
export const RADAR_ZONES = [
  { min: 0.75, label: 'sehr ähnlich', outer: 0.24 },
  { min: 0.5, label: 'ähnlich', outer: 0.36 },
  { min: 0.2, label: 'etwas gemeinsam', outer: 0.43 },
  { min: -Infinity, label: 'ganz anders', outer: 0.48 },
]
const RADAR_INNER = 0.07

/**
 * Radar layout around one bar: it sits in the middle, every other bar in the zone of its
 * similarity, closer the higher its rank, and in the direction it has in the base layout so
 * neighbourhoods keep their side. Returns positions 0-1.
 */
export function radarLayout(base: [number, number][], bars: (Bar | undefined)[], center: number, top: number[] = []): {
  pos: [number, number][]
  /** Per zone: its outer radius (0-1 units), its name and how many bars are in it. */
  rings: { r: number; label: string; n: number }[]
  rank: number[]
  /** Index into RADAR_ZONES per bar. */
  zone: number[]
} {
  const c = bars[center]
  const sims = bars.map((b, i) => (i === center || !b || !c ? -Infinity : profileCosine(c, b) ?? -1))
  // `top`: the precomputed most similar bars (full profile), first and in their order, so the
  // inner ring matches "Ähnliche Lokale"; the rest by the compact 16-number vector.
  const first = new Map(top.map((i, k) => [i, k]))
  const order = sims.map((s, i) => [s, i] as const).filter(([, i]) => i !== center)
    .sort((a, b) => (first.get(a[1]) ?? Infinity) - (first.get(b[1]) ?? Infinity) || b[0] - a[0])
  const rank = new Array<number>(bars.length).fill(0)
  order.forEach(([, i], k) => { rank[i] = k + 1 })

  // Each zone takes the next bars in the ranking, as many as reach its similarity.
  const others = order.map(([, i]) => i)
  let done = 0
  const groups = RADAR_ZONES.map((z) => {
    const n = Math.max(done, order.filter(([s]) => s >= z.min).length)
    const group = others.slice(done, n)
    done = n
    return group
  })
  const zone = new Array<number>(bars.length).fill(0)
  const radius = new Array<number>(bars.length).fill(0)
  groups.forEach((group, z) => {
    const inner = z === 0 ? RADAR_INNER : RADAR_ZONES[z - 1].outer
    const outer = RADAR_ZONES[z].outer
    group.forEach((i, j) => {
      const t = (j + 0.5) / group.length
      zone[i] = z
      // The first zone by distance, so that its few bars spread out; the others evenly by area.
      radius[i] = z === 0 ? inner + (outer - inner) * t : Math.sqrt(inner ** 2 + (outer ** 2 - inner ** 2) * t)
    })
  })

  const [cx, cy] = base[center]
  // Direction from the chosen bar in the base layout. A bar at the edge of the map would see all
  // others on one side (a cone, not a radar), so within each zone the directions are spread
  // evenly around the circle, keeping their order, then turned back to the zone's orientation.
  const raw = base.map(([x, y], i) => (x === cx && y === cy ? (i * 2.399) % (2 * Math.PI) - Math.PI : Math.atan2(y - cy, x - cx)))
  const angle = new Array<number>(base.length).fill(0)
  for (const group of groups) {
    const sorted = [...group].sort((a, b) => raw[a] - raw[b])
    const even = sorted.map((_, k) => -Math.PI + (2 * Math.PI * (k + 0.5)) / sorted.length)
    const sx = sorted.reduce((sum, i, k) => sum + Math.cos(raw[i] - even[k]), 0)
    const sy = sorted.reduce((sum, i, k) => sum + Math.sin(raw[i] - even[k]), 0)
    const turn = Math.atan2(sy, sx)
    sorted.forEach((i, k) => { angle[i] = even[k] + turn })
  }
  const pos = base.map((_, i): [number, number] => (i === center
    ? [0.5, 0.5]
    : [0.5 + radius[i] * Math.cos(angle[i]), 0.5 + radius[i] * Math.sin(angle[i])]))
  const rings = RADAR_ZONES.map((z, k) => ({ r: z.outer, label: z.label, n: groups[k].length }))
  return { pos, rings, rank, zone }
}

/** What sets one bar apart from the average, as words (non-style facets with a clear excess). */
export function barTraits(f: AtlasData['facets'], row: (number | null)[], n = 5): string[] {
  const out: { word: string; z: number }[] = []
  f.names.forEach((name, j) => {
    if (STYLE_SCALES.includes(name)) return
    const v = row[j]
    if (v == null) return
    const vals = f.values.map((r) => r[j]).filter((x): x is number => x != null)
    const sd = Math.sqrt(vals.reduce((s, x) => s + (x - f.mean[j]) ** 2, 0) / Math.max(1, vals.length)) || 1
    const z = (v - f.mean[j]) / sd
    if (z > 0.8) out.push({ word: f.high[j], z })
  })
  return out.sort((a, b) => b.z - a.z).slice(0, n).map((x) => x.word)
}

/** Territory colours: one hue per coarse territory, lighter or darker shades for its parts. */
const HUES = [28, 152, 258, 340, 200, 90]
export function territoryColors(data: AtlasData, level: number): string[] {
  const lv = data.levels[level]
  const coarse = data.levels[0]
  const parentOf = new Map<number, number>()
  lv.assign.forEach((c, i) => { if (!parentOf.has(c)) parentOf.set(c, coarse.assign[i]) })
  const siblings = new Map<number, number[]>()
  lv.clusters.forEach((_, c) => {
    const p = parentOf.get(c) ?? 0
    siblings.set(p, [...(siblings.get(p) ?? []), c])
  })
  return lv.clusters.map((_, c) => {
    const p = parentOf.get(c) ?? 0
    const sib = siblings.get(p)!
    const k = sib.indexOf(c)
    const light = sib.length > 1 ? 72 + (k / (sib.length - 1)) * 14 : 80
    return `hsl(${HUES[p % HUES.length]} 42% ${light}%)`
  })
}

/** What the land can be coloured by: the territories, a score, or one profile scale. */
export type AtlasOverlay = 'gebiete' | 'popularity' | 'satisfaction' | (typeof STYLE_SCALES)[number]

export const OVERLAYS: { key: AtlasOverlay; label: string; low?: string; high?: string }[] = [
  { key: 'gebiete', label: 'Gebiete' },
  { key: 'popularity', label: 'Beliebtheit', low: 'kaum bekannt', high: 'Publikumsmagnet' },
  { key: 'satisfaction', label: 'Zufriedenheit', low: 'gemischt', high: 'begeistert' },
  { key: 'traditionell_modern', label: 'traditionell ↔ modern', low: 'traditionell', high: 'modern' },
  { key: 'rau_schick', label: 'rau ↔ schick', low: 'rau', high: 'schick' },
  { key: 'ruhig_laut', label: 'ruhig ↔ laut', low: 'ruhig', high: 'laut' },
  { key: 'gemuetlichkeit', label: 'kühl ↔ gemütlich', low: 'kühl', high: 'gemütlich' },
  { key: 'preisniveau', label: 'günstig ↔ teuer', low: 'günstig', high: 'teuer' },
]

/**
 * Each bar's place in the overlay as a rank 0-1 among all bars that have the value (ties share
 * the middle rank), or null. Ranks rather than raw values, so the colours spread even where the
 * values bunch up (Zufriedenheit 60-90, style scales 2-4).
 */
export function overlayRanks(data: AtlasData, bars: (Bar | undefined)[], key: AtlasOverlay): (number | null)[] {
  if (key === 'gebiete') return bars.map(() => null)
  const j = data.facets.names.indexOf(key)
  const raw = bars.map((b, i) => (key === 'popularity' ? b?.popularity ?? null
    : key === 'satisfaction' ? b?.satisfaction ?? null : j >= 0 ? data.facets.values[i][j] : null))
  const sorted = raw.filter((v): v is number => v != null).sort((a, b) => a - b)
  if (sorted.length < 2) return raw.map(() => null)
  const rankOf = new Map<number, number>()
  let i = 0
  while (i < sorted.length) {
    let k = i
    while (k + 1 < sorted.length && sorted[k + 1] === sorted[i]) k++
    rankOf.set(sorted[i], (i + k) / 2 / (sorted.length - 1))
    i = k + 1
  }
  return raw.map((v) => (v == null ? null : rankOf.get(v)!))
}

/** Diverging ochre - cream - teal, for an overlay rank 0-1; unknown values stay cream. */
export function overlayColor(t: number | null): string {
  const lo = [196, 132, 58]
  const mid = [244, 236, 220]
  const hi = [38, 120, 128]
  if (t == null) return `rgb(${mid.join(',')})`
  const [a, b, u] = t < 0.5 ? [lo, mid, t * 2] : [mid, hi, (t - 0.5) * 2]
  return `rgb(${a.map((x, i) => Math.round(x + (b[i] - x) * u)).join(',')})`
}

/** What a touch gesture has done so far, in pixels of the Atlas area: scale, then shift. */
export interface ScreenTransform { s: number; tx: number; ty: number }
export const NO_TRANSFORM: ScreenTransform = { s: 1, tx: 0, ty: 0 }

/** Where the fingers are: their middle and, for two, the distance between them (0 for one). */
export interface TouchAnchor { x: number; y: number; d: number }

export function touchAnchor(points: { x: number; y: number }[]): TouchAnchor {
  const [a, b] = points
  return b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) } : { x: a.x, y: a.y, d: 0 }
}

/** `base` extended by the fingers moving `from` -> `to`: the point under them stays under them. */
export function pinchTransform(base: ScreenTransform, from: TouchAnchor, to: TouchAnchor, minS: number, maxS: number): ScreenTransform {
  const f = Math.max(minS / base.s, Math.min(maxS / base.s, from.d > 0 && to.d > 0 ? to.d / from.d : 1))
  return { s: base.s * f, tx: to.x + f * (base.tx - from.x), ty: to.y + f * (base.ty - from.y) }
}

export interface AtlasView { x: number; y: number; k: number }

/** The map view that looks like `view` with the finished gesture applied on top. */
export function applyTransform(view: AtlasView, t: ScreenTransform, fit: { scale: number; ox: number; oy: number }): AtlasView {
  return {
    k: view.k * t.s,
    x: t.s * view.x + ((t.s - 1) * fit.ox + t.tx) / fit.scale,
    y: t.s * view.y + ((t.s - 1) * fit.oy + t.ty) / fit.scale,
  }
}

/** Index of the allowed point nearest to (x, y) within `radius`, or -1: dots are smaller than fingers. */
export function nearestIndex(pos: [number, number][], x: number, y: number, radius: number, allowed: (i: number) => boolean): number {
  let best = -1
  let bestD = radius * radius
  pos.forEach(([px, py], i) => {
    const d = (px - x) ** 2 + (py - y) ** 2
    if (d <= bestD && allowed(i)) { best = i; bestD = d }
  })
  return best
}

export interface Box { x: number; y: number; w: number; h: number }

/** The candidates (best first) that fit without touching each other or anything `blocked`, at most `max`. */
export function placeBoxes<T extends Box>(candidates: T[], blocked: Box[], max: number): T[] {
  const hits = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
  const out: T[] = []
  for (const c of candidates) {
    if (out.length === max) break
    if (!blocked.some((b) => hits(c, b)) && !out.some((b) => hits(c, b))) out.push(c)
  }
  return out
}
