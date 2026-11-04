import { describe, expect, it } from 'vitest'
import { DAY } from './hours'
import type { Constraints } from './recommend'
import { proposeTours, solve, swapOptions, tourCost, type SolveOptions } from './solver'
import type { Matrices } from './travel'
import { VENUE_TYPES, type Bar } from './types'

function rng(seed: number) {
  let s = seed
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32)
}

/** `perDistrict` bars in each of `districts` districts at random points; walking only. */
function world(districts: number, perDistrict: number, seed: number) {
  const r = rng(seed)
  const bars: Bar[] = []
  for (let d = 1; d <= districts; d++) {
    const cx = r() * 10
    const cy = r() * 10
    for (let j = 0; j < perDistrict; j++) {
      const i = bars.length
      bars.push({
        id: `own:b${i}`, matrixIndex: i, name: `Bar ${i}`, district: d, lat: cy + r(), lon: cx + r(),
        venueType: 'pub_bar', weeklyOpen: null, official: [], tags: [], unreviewedTags: [],
      })
    }
  }
  const n = bars.length
  const walk = new Uint8Array(n * n)
  for (const a of bars) for (const b of bars) {
    walk[a.matrixIndex * n + b.matrixIndex] = Math.round(3 * Math.hypot(a.lat - b.lat, a.lon - b.lon))
  }
  const m: Matrices = { n, walk, transitP50: new Uint8Array(n * n).fill(255) }
  return { bars, m }
}

const filters: Constraints = {
  blockedDistricts: new Set(), includedDistricts: null, venueTypes: new Set(VENUE_TYPES), officialEdition: null,
  excludedBars: new Set(), departureMinuteOfWeek: null, walkToleranceMinutes: 5,
}

function options(districts: number, extra: Partial<SolveOptions> = {}): SolveOptions {
  return {
    districts: Array.from({ length: districts }, (_, i) => i + 1), filters, participants: [], lambda: 5,
    weekday: 5, startMinutes: 11 * 60, stopMinutes: 20, prefix: [], pinned: [], startDistrict: null,
    endDistrict: null, restarts: 4, seed: 7, ...extra,
  }
}

function permutations<T>(a: T[]): T[][] {
  if (a.length <= 1) return [a]
  return a.flatMap((x, i) => permutations([...a.slice(0, i), ...a.slice(i + 1)]).map((p) => [x, ...p]))
}

function bruteForce(bars: Bar[], m: Matrices, o: SolveOptions): number {
  const byD = new Map<number, Bar[]>()
  for (const b of bars) byD.set(b.district, [...(byD.get(b.district) ?? []), b])
  let best = Infinity
  for (const order of permutations(o.districts)) {
    const choose = (i: number, acc: Bar[]) => {
      if (i === order.length) { best = Math.min(best, tourCost(acc, m, o).cost); return }
      for (const b of byD.get(order[i])!) choose(i + 1, [...acc, b])
    }
    choose(0, [])
  }
  return best
}

describe('solve', () => {
  it('matches brute force on small cases', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const { bars, m } = world(5, 3, seed)
      const o = options(5)
      expect(solve(bars, m, o)!.cost).toBe(bruteForce(bars, m, o))
    }
  })

  it('visits exactly one bar per included district', () => {
    const { bars, m } = world(12, 8, 11)
    const o = options(12, { districts: [1, 3, 4, 7, 8, 12] })
    const s = solve(bars, m, o)!
    expect(s.stops.map((b) => b.district).sort((a, b) => a - b)).toEqual([1, 3, 4, 7, 8, 12])
  })

  it('keeps the fixed prefix, pinned bars and the last district', () => {
    const { bars, m } = world(10, 6, 5)
    const prefix = [bars[13], bars[2]]
    const pinned = [bars[40]]
    const s = solve(bars, m, options(10, { prefix, pinned, endDistrict: 9 }))!
    expect(s.stops.slice(0, 2)).toEqual(prefix)
    expect(s.stops).toContain(bars[40])
    expect(s.stops[s.stops.length - 1].district).toBe(9)
    expect(s.stops).toHaveLength(10)
  })

  it('starts in the chosen district', () => {
    const { bars, m } = world(8, 4, 9)
    const s = solve(bars, m, options(8, { startDistrict: 6 }))!
    expect(s.stops[0].district).toBe(6)
  })

  it('is no worse than the nearest-bar greedy tour', () => {
    const { bars, m } = world(15, 10, 21)
    const o = options(15)
    const s = solve(bars, m, o)!
    // Greedy: start at bar 0 and always walk to the nearest bar in a new district.
    const tour = [bars[0]]
    while (tour.length < 15) {
      const seen = new Set(tour.map((b) => b.district))
      const cur = tour[tour.length - 1]
      const next = bars.filter((b) => !seen.has(b.district))
        .sort((a, b) => m.walk[cur.matrixIndex * m.n + a.matrixIndex] - m.walk[cur.matrixIndex * m.n + b.matrixIndex])[0]
      tour.push(next)
    }
    expect(s.cost).toBeLessThanOrEqual(tourCost(tour, m, o).cost)
  })

  it('penalises bars closed on arrival but not unknown hours', () => {
    const { bars, m } = world(2, 1, 3)
    // Bar 1 is closed on Saturdays; bar 0 has unknown hours.
    bars[1].weeklyOpen = [[0, 5 * DAY]]
    const o = options(2)
    const s = tourCost(bars, m, o)
    expect(s.closedStops).toBe(1)
    expect(tourCost([bars[0]], m, o).closedStops).toBe(0)
  })

  it('prefers liked bars when the detour is small', () => {
    const { bars, m } = world(3, 4, 17)
    const liked = bars[5]
    liked.tags = ['urig']
    const o = options(3, { participants: [{ name: 'A', likes: ['urig'], avoids: [] }], lambda: 60 })
    expect(solve(bars, m, o)!.stops).toContain(liked)
  })
})

describe('proposeTours', () => {
  it('gives distinct start districts when no start is set', () => {
    const { bars, m } = world(8, 5, 4)
    const tours = proposeTours(bars, m, options(8), 3)
    expect(tours).toHaveLength(3)
    expect(new Set(tours.map((t) => t.stops[0].district)).size).toBe(3)
    expect(tours[0].cost).toBeLessThanOrEqual(tours[1].cost)
  })

  it('gives different tours from a fixed start', () => {
    const { bars, m } = world(8, 5, 4)
    const tours = proposeTours(bars, m, options(8, { prefix: [bars[0]] }), 3)
    expect(tours.length).toBeGreaterThan(1)
    for (const t of tours) expect(t.stops[0]).toBe(bars[0])
    expect(tours[0].stops.map((b) => b.id)).not.toEqual(tours[1].stops.map((b) => b.id))
  })
})

describe('swapOptions', () => {
  it('ranks same-district bars by fit between the neighbours', () => {
    const { bars, m } = world(3, 5, 8)
    const o = options(3)
    const s = solve(bars, m, o)!
    const opts = swapOptions(s.stops, 1, bars, m, o)
    expect(opts).toHaveLength(4)
    for (const x of opts) expect(x.bar.district).toBe(s.stops[1].district)
    // The solver's choice is optimal, so no swap improves the tour.
    expect(opts[0].delta).toBeGreaterThanOrEqual(0)
    expect(opts.map((x) => x.delta)).toEqual([...opts.map((x) => x.delta)].sort((a, b) => a - b))
  })
})
