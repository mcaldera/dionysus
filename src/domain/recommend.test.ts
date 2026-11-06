import { describe, expect, it } from 'vitest'
import { isOpenAt } from './hours'
import { jaccard, match, recommend, weights, type Constraints, type Preferences } from './recommend'
import { applyTagRows } from './tagRows'
import { timeline } from './tour'
import type { Matrices } from './travel'
import { VENUE_TYPES, type Bar, type Tag } from './types'

function bar(i: number, district: number, tags: Tag[] = [], weeklyOpen: Bar['weeklyOpen'] = null): Bar {
  return {
    id: `own:b${i}`, matrixIndex: i, name: `Bar ${i}`, district, lat: 48.2, lon: 16.37, venueType: 'pub_bar',
    weeklyOpen, official: [], tags, unreviewedTags: [],
  }
}

// Bar 0 is the origin; bars 1-4 are 5, 10, 15 and 20 minutes away on foot.
function matrices(n: number): Matrices {
  const walk = new Uint8Array(n * n)
  for (let u = 0; u < n; u++) for (let v = 0; v < n; v++) walk[u * n + v] = 5 * Math.abs(u - v)
  return { n, walk, transitP50: walk.map((x) => x) }
}

const constraints: Constraints = {
  blockedDistricts: new Set(), includedDistricts: null, venueTypes: new Set(VENUE_TYPES), officialEdition: null,
  excludedBars: new Set(), departureMinuteOfWeek: null, walkToleranceMinutes: 5,
}
const prefs: Preferences = { participants: [], similarity: 'ignore', speedVsMatch: 0.5 }

describe('recommend', () => {
  it('ranks by travel time when nothing else differs', () => {
    const bars = [0, 1, 2, 3, 4].map((i) => bar(i, i + 1))
    const recs = recommend(bars[0], bars, matrices(5), constraints, prefs)
    expect(recs.map((r) => r.bar.id)).toEqual(['own:b1', 'own:b2', 'own:b3', 'own:b4'])
    expect(recs[0].reasons[0]).toBe('5 Min. zu Fuß')
  })

  it('skips districts that already have a stop', () => {
    const bars = [bar(0, 1), bar(1, 2), bar(2, 3)]
    const recs = recommend(bars[0], bars, matrices(3), { ...constraints, blockedDistricts: new Set([2]) }, prefs)
    expect(recs.map((r) => r.bar.district)).toEqual([3])
  })

  it('"avoid" lowers a bar\'s rank but never removes it', () => {
    const bars = [bar(0, 1), bar(1, 2, ['absteige']), bar(2, 3)]
    const p: Preferences = { ...prefs, participants: [{ name: 'A', likes: [], avoids: ['absteige'] }] }
    const without = recommend(bars[0], bars, matrices(3), constraints, prefs)
    const withAvoid = recommend(bars[0], bars, matrices(3), constraints, p)
    expect(without[0].bar.id).toBe('own:b1')
    expect(withAvoid[0].bar.id).toBe('own:b2')
    expect(withAvoid.map((r) => r.bar.id)).toContain('own:b1')
  })

  it('drops bars known to be closed on arrival, keeps unknown hours', () => {
    const closed: [number, number][] = [[0, 60]] // Monday 00:00-01:00 only
    const bars = [bar(0, 1), bar(1, 2, [], closed), bar(2, 3, [], null)]
    const recs = recommend(bars[0], bars, matrices(3), { ...constraints, departureMinuteOfWeek: 12 * 60 }, prefs)
    expect(recs.map((r) => r.bar.id)).toEqual(['own:b2'])
  })

  it('applies the official filter to the newest edition', () => {
    const bars = [bar(0, 1), { ...bar(1, 2), official: ['2026-04'] }, { ...bar(2, 3), official: ['2026-04', '2026-10'] }]
    const recs = recommend(bars[0], bars, matrices(3), { ...constraints, officialEdition: '2026-10' }, prefs)
    expect(recs.map((r) => r.bar.id)).toEqual(['own:b2'])
  })
})

describe('scoring parts', () => {
  it('starting weights at slider 0.5', () => {
    const [w1, w2, w3, w4] = weights({ ...prefs, similarity: 'similar' })
    expect([w1, w2, w3, w4].map((w) => Math.round(w * 100) / 100)).toEqual([0.4, 0.3, 0.2, 0.1])
  })

  it('match is 0 for untagged bars and clamped to -1..1', () => {
    const p = [{ name: 'A', likes: ['urig'] as Tag[], avoids: ['modern'] as Tag[] }]
    expect(match(bar(0, 1), p)).toBe(0)
    expect(match(bar(0, 1, ['urig']), p)).toBe(0.5)
    expect(match(bar(0, 1, ['modern']), p)).toBe(-0.75)
  })

  it('jaccard', () => {
    expect(jaccard(['urig', 'essen'], ['urig'])).toBe(0.5)
    expect(jaccard([], [])).toBe(0)
  })
})

describe('hours and timeline', () => {
  it('handles intervals crossing Sunday midnight', () => {
    const weekly: [number, number][] = [[6 * 1440 + 20 * 60, 7 * 1440 + 2 * 60]] // Sunday 20:00 - Monday 02:00
    expect(isOpenAt(weekly, 60)).toBe(true) // Monday 01:00
    expect(isOpenAt(weekly, 3 * 60)).toBe(false)
    expect(isOpenAt(null, 0)).toBeNull()
  })

  it('timeline adds legs and stop time, first stop has no leg', () => {
    const bars = [bar(0, 1), bar(2, 2), bar(3, 3)]
    const t = timeline(bars, matrices(4), 5, 11 * 60, 20, 5)
    expect(t[0].legIn).toBeNull()
    expect(t.map((s) => s.arrival - 5 * 1440)).toEqual([660, 660 + 20 + 10, 660 + 20 + 10 + 20 + 5])
  })
})

describe('tag rows', () => {
  it('later rows win and value 0 removes', () => {
    const [b] = applyTagRows([bar(0, 1, ['essen'])], [
      { bar_id: 'own:b0', tag: 'urig', value: '1', source: 'claude', evidence: '', reviewed: '0' },
      { bar_id: 'own:b0', tag: 'essen', value: '0', source: 'manual', evidence: '', reviewed: '1' },
    ])
    expect(b.tags).toEqual(['urig'])
    expect(b.unreviewedTags).toEqual(['urig'])
  })
})

describe('taste finder', () => {
  it('turns quiz answers into liked and avoided tags and types', async () => {
    const { preferencesFrom } = await import('./taste')
    // Altes Beisl, cheap, no Absteige, Egal on the rest, Tschocherl and Beisl wanted.
    const p = preferencesFrom({ vibe: [0], price: [0], absteige: [1], types: [1, 2] })
    expect(p.likes).toEqual(['urig', 'preiswert'])
    expect(p.avoids).toEqual(['gehoben', 'absteige'])
    expect(p.likedTypes).toEqual(['tschocherl', 'beisl_wirtshaus'])
  })

  it('liking every venue type says nothing', async () => {
    const { preferencesFrom } = await import('./taste')
    expect(preferencesFrom({ types: [0, 1, 2, 3, 4] }).likedTypes).toEqual([])
  })

  it('venue type preferences count in match, also for untagged bars', () => {
    const p = [{ name: 'A', likes: [] as Tag[], avoids: [] as Tag[], likedTypes: ['pub_bar' as const] }]
    expect(match(bar(0, 1), p)).toBe(1)
  })
})

describe('profileCosine', () => {
  it('compares profile vectors and is null without a profile', async () => {
    const { profileCosine } = await import('./recommend')
    const bar = (vec?: number[]) => ({ profile: vec ? { xy: [0, 0], vec, similar: [] } : undefined }) as unknown as import('./types').Bar
    expect(profileCosine(bar([127, 0]), bar([127, 0]))).toBeCloseTo(1)
    expect(profileCosine(bar([127, 0]), bar([0, 127]))).toBeCloseTo(0)
    expect(profileCosine(bar([127, 0]), bar([-127, 0]))).toBeCloseTo(-1)
    expect(profileCosine(bar([127, 0]), bar())).toBeNull()
  })
})
