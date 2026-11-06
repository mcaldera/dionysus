import { describe, expect, it } from 'vitest'
import { barTraits, radarLayout, territoryColors, type AtlasData } from './atlas'
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
})
