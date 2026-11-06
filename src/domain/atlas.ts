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
 * Radar layout around one bar: it sits in the middle, every other bar at a radius by its
 * similarity rank (area-even, so rings read as "the n most similar"), in the direction it has
 * in the base layout so neighbourhoods keep their side. Returns positions 0-1.
 */
export function radarLayout(base: [number, number][], bars: (Bar | undefined)[], center: number): {
  pos: [number, number][]
  /** Radius (0-1 units) at which the n most similar end, for ring labels. */
  ringAt: (n: number) => number
  rank: number[]
} {
  const c = bars[center]
  const sims = bars.map((b, i) => (i === center || !b || !c ? -Infinity : profileCosine(c, b) ?? -1))
  const order = sims.map((s, i) => [s, i] as const).filter(([, i]) => i !== center).sort((a, b) => b[0] - a[0])
  const rank = new Array<number>(bars.length).fill(0)
  order.forEach(([, i], k) => { rank[i] = k + 1 })
  const n = Math.max(1, order.length)
  const R = 0.47
  const ringAt = (k: number) => R * Math.sqrt(Math.min(k, n) / n)
  const [cx, cy] = base[center]
  const pos = base.map(([x, y], i): [number, number] => {
    if (i === center) return [0.5, 0.5]
    let a = Math.atan2(y - cy, x - cx)
    // Bars on top of each other in the base layout: spread them by index.
    if (x === cx && y === cy) a = (i * 2.399) % (2 * Math.PI)
    const r = ringAt(rank[i] - 0.5)
    return [0.5 + r * Math.cos(a), 0.5 + r * Math.sin(a)]
  })
  return { pos, ringAt, rank }
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
