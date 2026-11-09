import { describe, expect, it } from 'vitest'
import { applyTransform, barTraits, nearestIndex, NO_TRANSFORM, overlayColor, overlayRanks, pinchTransform, placeBoxes, radarLayout, territoryColors, touchAnchor, type AtlasData } from './atlas'
import type { Bar } from './types'

const bar = (i: number, vec: number[]) => ({ id: `b${i}`, matrixIndex: i, profile: { vec, similar: [] } }) as unknown as Bar

describe('atlas', () => {
  it('puts the chosen bar in the middle and the most similar closest, on their side', () => {
    const bars = [bar(0, [127, 0]), bar(1, [120, 30]), bar(2, [0, 127]), bar(3, [-127, 0])]
    const base: [number, number][] = [[0.5, 0.5], [0.9, 0.5], [0.1, 0.5], [0.5, 0.9]]
    const { pos, rank } = radarLayout(base, bars, 0)
    expect(pos[0]).toEqual([0.5, 0.5])
    expect(rank.slice(1)).toEqual([1, 2, 3])
    const r = (p: [number, number]) => Math.hypot(p[0] - 0.5, p[1] - 0.5)
    expect(r(pos[1])).toBeLessThan(r(pos[2]))
    expect(r(pos[2])).toBeLessThan(r(pos[3]))
    expect(pos[1][0]).toBeGreaterThan(0.5) // bar 1 lay to the right and stays there
  })

  const data: AtlasData = {
    bars: [0, 1, 2, 3],
    layouts: { tsne: [], umap: [], pca: [] },
    levels: [
      { k: 2, assign: [0, 0, 1, 1], clusters: [{ name: 'A', desc: '', traits: [], n: 2 }, { name: 'B', desc: '', traits: [], n: 2 }] },
      { k: 4, assign: [0, 1, 2, 3], clusters: ['a', 'b', 'c', 'd'].map((name) => ({ name, desc: '', traits: [], n: 1 })) },
    ],
    facets: { names: ['ruhig_laut', 'wein', 'dart'], high: ['laut', 'Wein', 'Dart'], low: ['ruhig', null, null], mean: [3, 0.5, 0.25],
      values: [[3, 2, 0], [3, 0, 0], [3, 0, 1], [3, 0, 0]] },
  }

  it('names what sets a bar apart, but not its style scales', () => {
    expect(barTraits(data.facets, data.facets.values[0])).toEqual(['Wein'])
    expect(barTraits(data.facets, data.facets.values[2])).toEqual(['Dart'])
  })

  it('gives parts of one coarse territory the same hue', () => {
    const c = territoryColors(data, 1)
    expect(c[0].split(' ')[0]).toBe(c[1].split(' ')[0])
    expect(c[0].split(' ')[0]).not.toBe(c[2].split(' ')[0])
  })

  it('puts the precomputed most similar bars first, in their order', () => {
    const bars = [bar(0, [127, 0]), bar(1, [120, 30]), bar(2, [0, 127]), bar(3, [-127, 0])]
    const base: [number, number][] = [[0.5, 0.5], [0.9, 0.5], [0.1, 0.5], [0.5, 0.9]]
    expect(radarLayout(base, bars, 0, [3]).rank.slice(1)).toEqual([2, 3, 1])
  })

  it('ranks overlay values 0-1 with ties sharing a rank, and colours them', () => {
    const r = overlayRanks(data, [undefined, undefined, undefined, undefined], 'ruhig_laut')
    expect(r).toEqual([0.5, 0.5, 0.5, 0.5])
    const pop = overlayRanks(data, [10, 40, 40, 90].map((popularity) => ({ popularity }) as Bar), 'popularity')
    expect(pop).toEqual([0, 0.5, 0.5, 1])
    expect(overlayColor(null)).toBe(overlayColor(0.5))
  })

  it('sorts the radar into zones by how similar the bars really are', () => {
    // Cosines with bar 0: 0.97 (sehr ähnlich), 0.6 (ähnlich), 0.3 (etwas gemeinsam), -1 (ganz anders).
    const vec = (cos: number) => [Math.round(127 * cos), Math.round(127 * Math.sqrt(1 - cos * cos))]
    const bars = [bar(0, [127, 0]), bar(1, vec(0.97)), bar(2, vec(0.6)), bar(3, vec(0.3)), bar(4, vec(-1))]
    const base: [number, number][] = [[0.5, 0.5], [0.9, 0.5], [0.1, 0.5], [0.5, 0.9], [0.5, 0.1]]
    const { pos, rings, zone } = radarLayout(base, bars, 0)
    expect(zone.slice(1)).toEqual([0, 1, 2, 3])
    expect(rings.map((q) => q.n)).toEqual([1, 1, 1, 1])
    const r = (p: [number, number]) => Math.hypot(p[0] - 0.5, p[1] - 0.5)
    rings.forEach((q, z) => {
      expect(r(pos[z + 1])).toBeLessThan(q.r)
      if (z > 0) expect(r(pos[z + 1])).toBeGreaterThan(rings[z - 1].r)
    })
  })

  it('leaves the inner zone empty for a bar without close matches', () => {
    const bars = [bar(0, [127, 0]), bar(1, [0, 127]), bar(2, [-127, 0])]
    const base: [number, number][] = [[0.5, 0.5], [0.9, 0.5], [0.1, 0.5]]
    expect(radarLayout(base, bars, 0).rings.map((q) => q.n)).toEqual([0, 0, 0, 2])
  })

  it('keeps the point between the fingers under them while pinching', () => {
    const fit = { scale: 0.4, ox: 6, oy: 100 }
    const view = { x: 20, y: -30, k: 1.5 }
    const screen = (v: typeof view, p: [number, number]) => [fit.scale * (v.k * p[0] + v.x) + fit.ox, fit.scale * (v.k * p[1] + v.y) + fit.oy]
    // The map point that starts at the pinch's middle, (200, 300) on screen.
    const p: [number, number] = [(((200 - fit.ox) / fit.scale) - view.x) / view.k, (((300 - fit.oy) / fit.scale) - view.y) / view.k]
    const from = touchAnchor([{ x: 150, y: 300 }, { x: 250, y: 300 }])
    const to = touchAnchor([{ x: 100, y: 360 }, { x: 400, y: 360 }])
    expect(to.d / from.d).toBe(3)
    const t = pinchTransform(NO_TRANSFORM, from, to, 0.1, 10)
    const after = applyTransform(view, t, fit)
    expect(after.k).toBeCloseTo(4.5)
    expect(screen(after, p)[0]).toBeCloseTo(250)
    expect(screen(after, p)[1]).toBeCloseTo(360)
  })

  it('leaves the view alone without a gesture, pans with one finger and stops at the zoom limit', () => {
    const fit = { scale: 0.4, ox: 6, oy: 100 }
    const view = { x: 20, y: -30, k: 1.5 }
    expect(applyTransform(view, NO_TRANSFORM, fit)).toEqual(view)
    const pan = pinchTransform(NO_TRANSFORM, touchAnchor([{ x: 10, y: 10 }]), touchAnchor([{ x: 30, y: 0 }]), 0.1, 10)
    expect(pan).toEqual({ s: 1, tx: 20, ty: -10 })
    const big = pinchTransform(NO_TRANSFORM, touchAnchor([{ x: 0, y: 0 }, { x: 10, y: 0 }]), touchAnchor([{ x: 0, y: 0 }, { x: 500, y: 0 }]), 0.5, 2)
    expect(big.s).toBe(2)
  })

  it('finds the nearest allowed dot within reach', () => {
    const pos: [number, number][] = [[0, 0], [10, 0], [100, 0]]
    expect(nearestIndex(pos, 7, 0, 20, () => true)).toBe(1)
    expect(nearestIndex(pos, 7, 0, 20, (i) => i !== 1)).toBe(0)
    expect(nearestIndex(pos, 60, 0, 20, () => true)).toBe(-1)
  })

  it('places boxes in order, skipping overlaps and blocked space', () => {
    const b = (x: number) => ({ x, y: 0, w: 10, h: 10 })
    expect(placeBoxes([b(0), b(5), b(20), b(40)], [b(38)], 5)).toEqual([b(0), b(20)])
    expect(placeBoxes([b(0), b(20), b(40)], [], 2)).toEqual([b(0), b(20)])
  })
})
