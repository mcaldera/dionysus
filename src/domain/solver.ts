// Tour solver from SPEC section 9: one bar per district, in any order, open ends.
// Inner step: a layered dynamic programme picks the best bar per district for a fixed
// district order. Outer step: multi-start local search (2-opt, Or-opt) over that order.
// No React or browser APIs here, so the worker and the tests can use it alone.

import { DAY, isOpenAt, WEEK } from './hours'
import { match, passesFilters, type Constraints } from './recommend'
import type { Matrices } from './travel'
import type { Bar, Participant } from './types'

/** Minutes added per stop known to be closed on arrival (starting value). */
export const CLOSED_PENALTY = 90
/** Minutes added when a transit leg heads straight back the way the previous transit leg came. */
export const BACKTRACK_PENALTY = 30
/** Cosine of the turn between two legs below which it counts as going back (about 135°). */
const REVERSAL = -0.7
/** Minutes added per bar already used by an earlier proposal, so alternatives differ. */
const DIVERSITY_PENALTY = 3

export interface SolveOptions {
  /** Districts the tour must cover, including those of the prefix. */
  districts: number[]
  /** Venue types, official edition, excluded bars, walk tolerance. Blocked districts are ignored. */
  filters: Constraints
  participants: Participant[]
  /** Minutes the tour may grow for 1.0 of match (SPEC 9's λ). */
  lambda: number
  weekday: number
  startMinutes: number
  stopMinutes: number
  /** Stops fixed at the start, in this order. */
  prefix: Bar[]
  /** Bars that must be in the tour, at any position after the prefix. */
  pinned: Bar[]
  /** District of the first stop; only used without a prefix. */
  startDistrict: number | null
  endDistrict: number | null
  /** Penalise riding out and straight back, e.g. U1 out, one bar, U1 back. */
  noBacktrack?: boolean
  /** Candidates per district (SPEC: default 15, maximum 30). */
  k?: number
  restarts?: number
  seed?: number
}

export interface Solution {
  stops: Bar[]
  /** The objective: travel minutes + closed penalties − λ × match. */
  cost: number
  travelMinutes: number
  closedStops: number
  /** Districts that had no candidate after filtering. */
  missing: number[]
}

/** Leg minutes as `leg()` picks them: walk unless transit is faster by more than the tolerance. */
export function legCost(m: Matrices, u: number, v: number, tolerance: number): number {
  const i = u * m.n + v
  const w = m.walk[i]
  const t = m.transitP50[i]
  if (t === 255 || w <= t + tolerance) return w
  return t
}

/** Unit vector from a to b (x scaled for latitude), or [0, 0] if they coincide. */
function unit(a: { lat: number; lon: number }, b: { lat: number; lon: number }): [number, number] {
  const x = (b.lon - a.lon) * Math.cos((a.lat * Math.PI) / 180)
  const y = b.lat - a.lat
  const n = Math.hypot(x, y)
  return n ? [x / n, y / n] : [0, 0]
}

/** Direction of the leg if it is ridden by transit, else [0, 0], so dot products with it are 0. */
function transitDir(m: Matrices, a: Bar, b: Bar, tolerance: number): [number, number] {
  const i = a.matrixIndex * m.n + b.matrixIndex
  const w = m.walk[i]
  const t = m.transitP50[i]
  return t !== 255 && w > t + tolerance ? unit(a, b) : [0, 0]
}

export type TourCostOptions = Omit<SolveOptions, 'districts' | 'prefix' | 'pinned' | 'startDistrict' | 'endDistrict'>

/** The objective for a fixed list of stops; the same numbers the timeline shows. */
export function tourCost(stops: Bar[], m: Matrices, o: TourCostOptions): Solution {
  let t = o.weekday * DAY + o.startMinutes
  let travel = 0
  let closed = 0
  let matchSum = 0
  let backtracks = 0
  let dir: [number, number] = [0, 0]
  stops.forEach((b, i) => {
    if (i > 0) {
      const tol = o.filters.walkToleranceMinutes
      const l = legCost(m, stops[i - 1].matrixIndex, b.matrixIndex, tol)
      travel += l
      t += l
      const next = transitDir(m, stops[i - 1], b, tol)
      if (o.noBacktrack && dir[0] * next[0] + dir[1] * next[1] < REVERSAL) backtracks++
      dir = next
    }
    if (isOpenAt(b.weeklyOpen, t) === false) closed++
    matchSum += match(b, o.participants)
    t += o.stopMinutes
  })
  return {
    stops, cost: travel + closed * CLOSED_PENALTY + backtracks * BACKTRACK_PENALTY - o.lambda * matchSum,
    travelMinutes: travel, closedStops: closed, missing: [],
  }
}

/** false if the hours are known and the bar isn't open at any time in [from, to). */
function opensDuring(weekly: [number, number][] | null, from: number, to: number): boolean {
  if (!weekly) return true
  const a = ((from % WEEK) + WEEK) % WEEK
  const b = a + (to - from)
  return weekly.some(([s, e]) => (s < b && a < e) || (s < b - WEEK && a - WEEK < e) || (s + WEEK < b && a < e + WEEK))
}

function mulberry32(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32
  }
}

const MATCH_SHARE = 0.5
const KNOWN_SHARE = 0.25
const CONN_SHARE = 0.25

/** Known places first when nothing else differs: tips, official lists and tags. */
function richness(b: Bar): number {
  return 2 * (b.tips?.length ?? 0) + b.official.length + 0.5 * b.tags.length
}

let connCache: { key: string; bars: Bar[]; conn: Map<string, number> } | null = null

/**
 * Connectivity of each pool bar: the sum of its two shortest legs to bars of other districts.
 * Cached for the last filter set, because recommendation refinement solves many times in a row.
 */
function connectivity(bars: Bar[], m: Matrices, o: SolveOptions, pools: Map<number, Bar[]>): Map<string, number> {
  const key = JSON.stringify([[...o.filters.venueTypes].sort(), o.filters.officialEdition, [...o.filters.excludedBars].sort(),
    o.filters.walkToleranceMinutes, o.weekday, o.startMinutes, [...pools.keys()].sort((a, b) => a - b)])
  if (connCache && connCache.key === key && connCache.bars === bars) return connCache.conn
  const conn = new Map<string, number>()
  const tol = o.filters.walkToleranceMinutes
  for (const [d, list] of pools) {
    for (const b of list) {
      const best: number[] = []
      for (const [d2, other] of pools) {
        if (d2 === d) continue
        let mn = 255
        for (const x of other) mn = Math.min(mn, legCost(m, b.matrixIndex, x.matrixIndex, tol))
        best.push(mn)
      }
      best.sort((a, z) => a - z)
      conn.set(b.id, (best[0] ?? 0) + (best[1] ?? 0))
    }
  }
  connCache = { key, bars, conn }
  return conn
}

/**
 * K candidates per district: half by match (or, with no preferences, known places), then
 * bars close to other districts, which make good handovers, then bars spread across the district.
 */
export function candidates(bars: Bar[], m: Matrices, o: SolveOptions, districts: number[]): Map<number, Bar[]> {
  const k = Math.min(30, Math.max(1, o.k ?? 15))
  const filters: Constraints = { ...o.filters, blockedDistricts: new Set(), includedDistricts: null }
  const pinnedBy = new Map(o.pinned.map((b) => [b.district, b]))
  // Pools cover all plan districts, so connectivity stays the same while the prefix grows.
  const want = new Set([...o.districts, ...districts])
  const dayStart = o.weekday * DAY + o.startMinutes
  const pools = new Map<number, Bar[]>()
  for (const b of bars) {
    if (!want.has(b.district) || !passesFilters(b, filters)) continue
    // Known to be closed for the whole plausible tour window: not worth a slot.
    if (!opensDuring(b.weeklyOpen, dayStart, dayStart + 14 * 60)) continue
    let list = pools.get(b.district)
    if (!list) pools.set(b.district, (list = []))
    list.push(b)
  }
  const conn = connectivity(bars, m, o, pools)
  const out = new Map<number, Bar[]>()
  for (const d of districts) {
    const pinned = pinnedBy.get(d)
    if (pinned) {
      out.set(d, [pinned])
      continue
    }
    const pool = pools.get(d) ?? []
    if (pool.length <= k) {
      if (pool.length) out.set(d, pool)
      continue
    }
    const scored = pool.map((b) => ({ b, m: match(b, o.participants), r: richness(b) }))
    scored.sort((x, y) => y.m - x.m || y.r - x.r || x.b.id.localeCompare(y.b.id))
    const byMatch = o.participants.length ? Math.ceil(k * MATCH_SHARE) : Math.ceil(k * KNOWN_SHARE)
    const picked = scored.slice(0, byMatch).map((s) => s.b)
    const rest = scored.slice(picked.length).map((s) => s.b)
    rest.sort((x, y) => conn.get(x.id)! - conn.get(y.id)!)
    picked.push(...rest.splice(0, Math.ceil(k * CONN_SHARE)))
    // Farthest-point sampling over the rest, so border bars and corners get a chance.
    const coslat = Math.cos((48.2 * Math.PI) / 180)
    const gap = rest.map((b) => Math.min(...picked.map((p) => (b.lat - p.lat) ** 2 + ((b.lon - p.lon) * coslat) ** 2)))
    while (picked.length < k && rest.length) {
      let best = 0
      for (let i = 1; i < rest.length; i++) if (gap[i] > gap[best]) best = i
      const p = rest[best]
      picked.push(p)
      rest.splice(best, 1)
      gap.splice(best, 1)
      for (let i = 0; i < rest.length; i++) {
        gap[i] = Math.min(gap[i], (rest[i].lat - p.lat) ** 2 + ((rest[i].lon - p.lon) * coslat) ** 2)
      }
    }
    out.set(d, picked)
  }
  return out
}

interface Layer {
  cost: Float64Array
  time: Float64Array
  /** Direction of the incoming leg if it was transit, else 0. */
  dx: Float32Array
  dy: Float32Array
}

/** Candidates and leg tables for one solve; the local search only touches district order. */
class Model {
  readonly D: number
  readonly cands: Bar[][]
  /** legs[a][b][p * K_b + q]: minutes from candidate p of district a to candidate q of district b. */
  readonly legs: Uint8Array[][]
  /** Minutes from the last prefix stop to each candidate of district b. */
  readonly startLegs: Uint8Array[] | null
  /** ux/uy[a][b][p * K_b + q]: unit direction of that leg if ridden by transit, else 0. */
  private readonly ux: Float32Array[][]
  private readonly uy: Float32Array[][]
  private readonly startUx: Float32Array[] | null
  private readonly startUy: Float32Array[] | null
  /** Direction of the last prefix leg if it was transit. */
  private readonly prefixDir: [number, number]
  private readonly backtrack: boolean
  readonly t0: number
  readonly weights: Float64Array[]
  /** closedAt[d][c][t - dayStart] = 1 if candidate c is known to be closed at minute t; null = unknown hours. */
  private readonly closedAt: (Uint8Array | null)[][]
  private readonly dayStart: number
  private readonly cache: Layer[]
  private readonly scratch: Layer[]

  readonly o: SolveOptions

  constructor(districts: number[], cands: Map<number, Bar[]>, m: Matrices, o: SolveOptions, penalty: Map<string, number>) {
    this.o = o
    this.D = districts.length
    this.cands = districts.map((d) => cands.get(d)!)
    const tol = o.filters.walkToleranceMinutes
    this.backtrack = !!o.noBacktrack
    this.legs = this.cands.map((from) => this.cands.map((to) => {
      const t = new Uint8Array(from.length * to.length)
      from.forEach((p, i) => to.forEach((q, j) => { t[i * to.length + j] = legCost(m, p.matrixIndex, q.matrixIndex, tol) }))
      return t
    }))
    const dirs = (from: Bar[], to: Bar[], k: 0 | 1) => {
      const t = new Float32Array(from.length * to.length)
      if (this.backtrack) from.forEach((p, i) => to.forEach((q, j) => { t[i * to.length + j] = transitDir(m, p, q, tol)[k] }))
      return t
    }
    this.ux = this.cands.map((from) => this.cands.map((to) => dirs(from, to, 0)))
    this.uy = this.cands.map((from) => this.cands.map((to) => dirs(from, to, 1)))
    const last = o.prefix[o.prefix.length - 1]
    this.startLegs = last ? this.cands.map((to) => Uint8Array.from(to, (q) => legCost(m, last.matrixIndex, q.matrixIndex, tol))) : null
    this.startUx = last ? this.cands.map((to) => dirs([last], to, 0)) : null
    this.startUy = last ? this.cands.map((to) => dirs([last], to, 1)) : null
    const beforeLast = o.prefix[o.prefix.length - 2]
    this.prefixDir = beforeLast && this.backtrack ? transitDir(m, beforeLast, last, tol) : [0, 0]
    this.t0 = last ? tourEnd(o.prefix, m, o) : o.weekday * DAY + o.startMinutes
    this.weights = this.cands.map((list) => Float64Array.from(list, (b) => -o.lambda * match(b, o.participants) + (penalty.get(b.id) ?? 0)))
    this.dayStart = o.weekday * DAY
    this.closedAt = this.cands.map((list) => list.map((b) => closedTable(b.weeklyOpen, this.dayStart)))
    const K = Math.max(1, ...this.cands.map((c) => c.length))
    const buf = (): Layer[] => Array.from({ length: this.D }, () => ({
      cost: new Float64Array(K), time: new Float64Array(K), dx: new Float32Array(K), dy: new Float32Array(K),
    }))
    this.cache = buf()
    this.scratch = buf()
  }

  private penalty(d: number, c: number, t: number): number {
    const table = this.closedAt[d][c]
    if (!table) return 0
    const i = t - this.dayStart
    if (i >= 0 && i < HORIZON) return table[i] ? CLOSED_PENALTY : 0
    return isOpenAt(this.cands[d][c].weeklyOpen, t) === false ? CLOSED_PENALTY : 0
  }

  /** One DP layer: best cost, arrival and incoming transit direction for each candidate of order[pos]. */
  private layer(order: number[], pos: number, prev: Layer | null, out: Layer, back?: Int32Array) {
    const d = order[pos]
    const list = this.cands[d]
    const w = this.weights[d]
    const K = list.length
    const stop = this.o.stopMinutes
    if (pos === 0 || !prev) {
      const [px, py] = this.prefixDir
      for (let c = 0; c < K; c++) {
        const l = this.startLegs ? this.startLegs[d][c] : 0
        const t = this.t0 + l
        const ux = this.startUx ? this.startUx[d][c] : 0
        const uy = this.startUy ? this.startUy[d][c] : 0
        const bt = px * ux + py * uy < REVERSAL ? BACKTRACK_PENALTY : 0
        out.cost[c] = l + bt + w[c] + this.penalty(d, c, t)
        out.time[c] = t
        out.dx[c] = ux
        out.dy[c] = uy
      }
      return
    }
    const pd = order[pos - 1]
    const table = this.legs[pd][d]
    const ux = this.ux[pd][d]
    const uy = this.uy[pd][d]
    const Kp = this.cands[pd].length
    const bt = this.backtrack
    for (let c = 0; c < K; c++) {
      let best = Infinity
      let bq = 0
      for (let q = 0; q < Kp; q++) {
        const i = q * K + c
        let v = prev.cost[q] + table[i]
        if (bt && prev.dx[q] * ux[i] + prev.dy[q] * uy[i] < REVERSAL) v += BACKTRACK_PENALTY
        if (v < best) { best = v; bq = q }
      }
      const i = bq * K + c
      const t = prev.time[bq] + stop + table[i]
      out.cost[c] = best + w[c] + this.penalty(d, c, t)
      out.time[c] = t
      out.dx[c] = ux[i]
      out.dy[c] = uy[i]
      if (back) back[c] = bq
    }
  }

  private static min(a: Float64Array, n: number): number {
    let best = Infinity
    for (let i = 0; i < n; i++) if (a[i] < best) best = a[i]
    return best
  }

  /** Full evaluation of `order`; fills the cache that `tryFrom` builds on. */
  evaluate(order: number[]): number {
    for (let p = 0; p < this.D; p++) this.layer(order, p, p ? this.cache[p - 1] : null, this.cache[p])
    return Model.min(this.cache[this.D - 1].cost, this.cands[order[this.D - 1]].length)
  }

  /** Cost of `order`, which equals the cached order before position `from`. Doesn't touch the cache. */
  tryFrom(order: number[], from: number): number {
    for (let p = from; p < this.D; p++) {
      const prev = p === from ? (p ? this.cache[p - 1] : null) : this.scratch[p - 1]
      this.layer(order, p, prev, this.scratch[p])
    }
    return Model.min(this.scratch[this.D - 1].cost, this.cands[order[this.D - 1]].length)
  }

  /** Make the last `tryFrom` the cached state. */
  accept(from: number) {
    for (let p = from; p < this.D; p++) {
      const a = this.cache[p]
      const b = this.scratch[p]
      a.cost.set(b.cost)
      a.time.set(b.time)
      a.dx.set(b.dx)
      a.dy.set(b.dy)
    }
  }

  /** The chosen bar per district, in order. */
  path(order: number[]): Bar[] {
    const backs = order.map((d) => new Int32Array(this.cands[d].length))
    for (let p = 0; p < this.D; p++) this.layer(order, p, p ? this.cache[p - 1] : null, this.cache[p], backs[p])
    let c = 0
    const last = this.cache[this.D - 1].cost
    for (let i = 1; i < this.cands[order[this.D - 1]].length; i++) if (last[i] < last[c]) c = i
    const out: Bar[] = []
    for (let p = this.D - 1; p >= 0; p--) {
      out.push(this.cands[order[p]][c])
      c = backs[p][c]
    }
    return out.reverse()
  }

  /** Rough district distances for greedy starts: the shortest leg between their candidates. */
  districtGap(): number[][] {
    return this.legs.map((row) => row.map((t) => t.reduce((a, b) => Math.min(a, b), 255)))
  }
}

/** Minutes covered by the closed-lookup tables, from midnight of the tour day. */
const HORIZON = 2 * DAY

function closedTable(weekly: [number, number][] | null, dayStart: number): Uint8Array | null {
  if (!weekly) return null
  const t = new Uint8Array(HORIZON).fill(1)
  for (const [a, b] of weekly) {
    for (const shift of [-WEEK, 0, WEEK]) {
      const from = Math.max(0, a + shift - dayStart)
      const to = Math.min(HORIZON, b + shift - dayStart)
      if (from < to) t.fill(0, from, to)
    }
  }
  return t
}

function tourEnd(stops: Bar[], m: Matrices, o: SolveOptions): number {
  let t = o.weekday * DAY + o.startMinutes
  stops.forEach((b, i) => {
    if (i > 0) t += legCost(m, stops[i - 1].matrixIndex, b.matrixIndex, o.filters.walkToleranceMinutes)
    t += o.stopMinutes
  })
  return t
}

/** First-improvement 2-opt and Or-opt over positions [lo, hi), until a full pass finds nothing. */
function localSearch(model: Model, order: number[], lo: number, hi: number): number {
  let cost = model.evaluate(order)
  const moved = order.slice()
  let improved = true
  while (improved) {
    improved = false
    // 2-opt: reverse order[i..j].
    for (let i = lo; i < hi - 1; i++) {
      for (let j = i + 1; j < hi; j++) {
        reverse(order, i, j)
        const c = model.tryFrom(order, i)
        if (c < cost - 1e-9) { cost = c; model.accept(i); improved = true }
        else reverse(order, i, j)
      }
    }
    // Or-opt: move a run of 1-3 districts from position i to position j.
    for (let len = 1; len <= 3; len++) {
      for (let i = lo; i + len <= hi; i++) {
        for (let j = lo; j + len <= hi; j++) {
          if (j === i) continue
          orMove(order, moved, i, j, len)
          const from = Math.min(i, j)
          const c = model.tryFrom(moved, from)
          if (c < cost - 1e-9) {
            for (let p = from; p < order.length; p++) order[p] = moved[p]
            cost = c
            model.accept(from)
            improved = true
          }
        }
      }
    }
  }
  return cost
}

/** out = order with the run order[i..i+len) moved to start at position j. */
function orMove(order: number[], out: number[], i: number, j: number, len: number) {
  let w = 0
  for (let p = 0; p < order.length; p++) {
    if (w === j) for (let q = 0; q < len; q++) out[w++] = order[i + q]
    if (p >= i && p < i + len) continue
    out[w++] = order[p]
  }
  if (w === j) for (let q = 0; q < len; q++) out[w++] = order[i + q]
}

function reverse(a: number[], i: number, j: number) {
  for (; i < j; i++, j--) [a[i], a[j]] = [a[j], a[i]]
}

/** Nearest-neighbour order over districts, choosing among the `width` nearest at random. */
function greedy(gap: number[][], first: number, fixedLast: number | null, D: number, rand: () => number, width: number): number[] {
  const left = new Set(Array.from({ length: D }, (_, i) => i))
  left.delete(first)
  if (fixedLast !== null) left.delete(fixedLast)
  const order = [first]
  while (left.size) {
    const cur = order[order.length - 1]
    const near = [...left].sort((a, b) => gap[cur][a] - gap[cur][b]).slice(0, width)
    const next = near[Math.floor(rand() * near.length)]
    order.push(next)
    left.delete(next)
  }
  if (fixedLast !== null && fixedLast !== first) order.push(fixedLast)
  return order
}

interface Prepared {
  model: Model
  districts: number[]
  missing: number[]
}

function prepare(bars: Bar[], m: Matrices, o: SolveOptions, penalty: Map<string, number>): Prepared | null {
  const done = new Set(o.prefix.map((b) => b.district))
  const todo = [...new Set(o.districts)].filter((d) => !done.has(d))
  const cands = candidates(bars, m, o, todo)
  const districts = todo.filter((d) => cands.has(d))
  const missing = todo.filter((d) => !cands.has(d))
  if (!districts.length) return null
  return { model: new Model(districts, cands, m, o, penalty), districts, missing }
}

function search(p: Prepared, o: SolveOptions, startDistrict: number | null): Bar[] {
  const { model, districts } = p
  const D = districts.length
  const startIdx = o.prefix.length === 0 && startDistrict !== null ? districts.indexOf(startDistrict) : -1
  const endIdx = o.endDistrict !== null ? districts.indexOf(o.endDistrict) : -1
  const fixedLast = endIdx >= 0 && endIdx !== startIdx && D > 1 ? endIdx : null
  const lo = startIdx >= 0 ? 1 : 0
  const hi = fixedLast !== null ? D - 1 : D
  const rand = mulberry32(o.seed ?? 1)
  const gap = model.districtGap()

  // Restart 0: the best plain nearest-neighbour order over all allowed first districts.
  const firsts = startIdx >= 0 ? [startIdx] : Array.from({ length: D }, (_, i) => i).filter((i) => i !== fixedLast)
  let bestOrder: number[] = []
  let bestCost = Infinity
  for (const f of firsts) {
    const ord = greedy(gap, f, fixedLast, D, rand, 1)
    const c = model.evaluate(ord)
    if (c < bestCost) { bestCost = c; bestOrder = ord }
  }
  const restarts = Math.max(1, o.restarts ?? 3)
  const starts = [bestOrder]
  for (let r = 1; r < restarts; r++) {
    starts.push(greedy(gap, firsts[Math.floor(rand() * firsts.length)], fixedLast, D, rand, 3))
  }
  bestCost = Infinity
  for (const start of starts) {
    const ord = start.slice()
    const c = localSearch(model, ord, lo, hi)
    if (c < bestCost) { bestCost = c; bestOrder = ord }
  }
  model.evaluate(bestOrder)
  return [...o.prefix, ...model.path(bestOrder)]
}

/**
 * Polish: the search only sees K candidates per district, so try every eligible bar in each
 * free position and keep improvements, until a full pass changes nothing.
 */
function polish(stops: Bar[], bars: Bar[], m: Matrices, o: SolveOptions): Bar[] {
  const fixed = new Set([...o.prefix, ...o.pinned].map((b) => b.id))
  const filters: Constraints = { ...o.filters, blockedDistricts: new Set(), includedDistricts: null }
  const byDistrict = new Map<number, Bar[]>()
  const want = new Set(stops.map((b) => b.district))
  for (const b of bars) {
    if (!want.has(b.district) || !passesFilters(b, filters)) continue
    let list = byDistrict.get(b.district)
    if (!list) byDistrict.set(b.district, (list = []))
    list.push(b)
  }
  const out = stops.slice()
  let cost = tourCost(out, m, o).cost
  for (let pass = 0, improved = true; improved && pass < 5; pass++) {
    improved = false
    for (let i = 0; i < out.length; i++) {
      if (fixed.has(out[i].id)) continue
      const cur = out[i]
      let best = cur
      for (const b of byDistrict.get(cur.district) ?? []) {
        if (b === cur) continue
        out[i] = b
        const c = tourCost(out, m, o).cost
        if (c < cost - 1e-9) { cost = c; best = b; improved = true }
      }
      out[i] = best
    }
  }
  return out
}

/** The best tour found for these options. */
export function solve(bars: Bar[], m: Matrices, o: SolveOptions, penalty = new Map<string, number>()): Solution | null {
  const p = prepare(bars, m, o, penalty)
  if (!p) return o.prefix.length ? { ...tourCost(o.prefix, m, o), missing: [] } : null
  return { ...tourCost(polish(search(p, o, o.startDistrict), bars, m, o), m, o), missing: p.missing }
}

function sameStops(a: Bar[], b: Bar[]): boolean {
  return a.length === b.length && a.every((x, i) => x.id === b[i].id)
}

/**
 * Several good tours. Without a start, each district is tried as the start and the best
 * three starts are refined (SPEC 9, "suggest a start district"). With a start, later
 * alternatives are pushed away from bars the earlier ones used.
 * `onProgress` may return false to stop early (cancelled).
 */
export function proposeTours(
  bars: Bar[], m: Matrices, o: SolveOptions, count = 3,
  onProgress?: (done: number, total: number) => boolean,
): Solution[] {
  const out: Solution[] = []
  const free = o.prefix.length === 0 && o.startDistrict === null
  if (free) {
    const p = prepare(bars, m, o, new Map())
    if (!p) return []
    const quick: { d: number; cost: number }[] = []
    const total = p.districts.length + count
    for (const [i, d] of p.districts.entries()) {
      if (d === o.endDistrict && p.districts.length > 1) continue
      const stops = search(p, { ...o, restarts: 1 }, d)
      quick.push({ d, cost: tourCost(stops, m, o).cost })
      if (onProgress && !onProgress(i + 1, total)) return []
    }
    quick.sort((a, b) => a.cost - b.cost)
    for (const [i, q] of quick.slice(0, count).entries()) {
      out.push({ ...tourCost(polish(search(p, o, q.d), bars, m, o), m, o), missing: p.missing })
      if (onProgress && !onProgress(p.districts.length + i + 1, total)) return []
    }
  } else {
    const penalty = new Map<string, number>()
    const fixed = new Set([...o.prefix, ...o.pinned].map((b) => b.id))
    for (let i = 0; i < count; i++) {
      const s = solve(bars, m, { ...o, seed: (o.seed ?? 1) + i }, penalty)
      if (!s) break
      if (!out.some((x) => sameStops(x.stops, s.stops))) out.push(s)
      for (const b of s.stops) if (!fixed.has(b.id)) penalty.set(b.id, (penalty.get(b.id) ?? 0) + DIVERSITY_PENALTY)
      if (onProgress && !onProgress(i + 1, count)) return []
    }
  }
  return out.sort((a, b) => a.cost - b.cost)
}

/** A place in the tour: a district, with a bar or still empty. */
export interface Slot {
  district: number
  bar: Bar | null
}

/**
 * Complete a tour while keeping its slots in their order: empty slots get the best bar
 * between their neighbours, filled ones stay, and districts without a slot are added after
 * the last one in the best order (respecting a last district). Used for the empty template
 * and "Tour fertig planen".
 */
export function completeTour(bars: Bar[], m: Matrices, o: SolveOptions, slots: Slot[]): Solution | null {
  const filled = slots.flatMap((sl) => (sl.bar ? [sl.bar] : []))
  const opts: SolveOptions = { ...o, prefix: [], pinned: filled, startDistrict: null }
  const inSlots = slots.map((sl) => sl.district)
  const extra = [...new Set(o.districts)].filter((d) => !inSlots.includes(d))
  const cands = candidates(bars, m, opts, [...inSlots, ...extra])
  const fixed = inSlots.filter((d) => cands.has(d))
  const tail = extra.filter((d) => cands.has(d))
  const districts = [...fixed, ...tail]
  if (!districts.length) return null
  const model = new Model(districts, cands, m, opts, new Map())
  const order = districts.map((_, i) => i)
  const L = fixed.length
  const D = districts.length
  // Tail: nearest neighbour from the last slot, with the last district (if any) at the end.
  const endIdx = o.endDistrict !== null ? districts.indexOf(o.endDistrict) : -1
  const fixedLast = endIdx >= L ? endIdx : null
  if (D > L) {
    const gap = model.districtGap()
    const left = new Set(order.slice(L).filter((i) => i !== fixedLast))
    const tailOrder: number[] = []
    let cur = L > 0 ? L - 1 : -1
    while (left.size) {
      const next = cur < 0 ? [...left][0] : [...left].sort((a, b) => gap[cur][a] - gap[cur][b])[0]
      tailOrder.push(next)
      left.delete(next)
      cur = next
    }
    if (fixedLast !== null) tailOrder.push(fixedLast)
    order.splice(L, D - L, ...tailOrder)
    localSearch(model, order, L, fixedLast !== null ? D - 1 : D)
  }
  model.evaluate(order)
  const stops = polish(model.path(order), bars, m, opts)
  return { ...tourCost(stops, m, o), missing: extra.filter((d) => !cands.has(d)) }
}

export interface SwapOption {
  bar: Bar
  /** Change of the objective in minutes against the current stop; negative is better. */
  delta: number
  /** Change of travel minutes alone. */
  travelDelta: number
  closed: boolean
}

/**
 * Bars for slot `index`, ranked by how well they fit between the filled slots before and
 * after it (including later opening-hour effects). For a filled slot, delta is against its
 * current bar; for an empty one, it is what the stop adds to the tour.
 */
export function slotOptions(
  slots: Slot[], index: number, bars: Bar[], m: Matrices, o: TourCostOptions, limit = 8,
): SwapOption[] {
  const before = slots.slice(0, index).flatMap((sl) => (sl.bar ? [sl.bar] : []))
  const after = slots.slice(index + 1).flatMap((sl) => (sl.bar ? [sl.bar] : []))
  const cur = slots[index].bar
  const stops = [...before, ...(cur ? [cur] : []), ...after]
  if (cur) return swapOptions(stops, before.length, bars, m, o, limit)
  const base = tourCost(stops, m, o)
  const filters: Constraints = { ...o.filters, blockedDistricts: new Set(), includedDistricts: null }
  const closedBefore = tourCost(before, m, o).closedStops
  const out: SwapOption[] = []
  for (const b of bars) {
    if (b.district !== slots[index].district || !passesFilters(b, filters)) continue
    const trial = [...before, b, ...after]
    const s = tourCost(trial, m, o)
    out.push({
      bar: b, delta: s.cost - base.cost, travelDelta: s.travelMinutes - base.travelMinutes,
      closed: tourCost([...before, b], m, o).closedStops > closedBefore,
    })
  }
  out.sort((a, b) => a.delta - b.delta || richness(b.bar) - richness(a.bar))
  return out.slice(0, limit)
}

/** The same numbers as `slotOptions` for one bar, e.g. the one under the mouse. */
export function slotDelta(slots: Slot[], index: number, bar: Bar, m: Matrices, o: TourCostOptions): { delta: number; travelDelta: number } {
  const before = slots.slice(0, index).flatMap((sl) => (sl.bar ? [sl.bar] : []))
  const after = slots.slice(index + 1).flatMap((sl) => (sl.bar ? [sl.bar] : []))
  const cur = slots[index].bar
  const base = tourCost([...before, ...(cur ? [cur] : []), ...after], m, o)
  const s = tourCost([...before, bar, ...after], m, o)
  return { delta: s.cost - base.cost, travelDelta: s.travelMinutes - base.travelMinutes }
}

/**
 * Other bars for stop `index` in the same district, ranked by how well they fit between
 * the stops before and after it (including later opening-hour effects).
 */
export function swapOptions(
  stops: Bar[], index: number, bars: Bar[], m: Matrices, o: TourCostOptions, limit = 8,
): SwapOption[] {
  const cur = stops[index]
  const base = tourCost(stops, m, o)
  const filters: Constraints = { ...o.filters, blockedDistricts: new Set(), includedDistricts: null }
  const out: SwapOption[] = []
  const trial = stops.slice()
  for (const b of bars) {
    if (b.district !== cur.district || b.id === cur.id || !passesFilters(b, filters)) continue
    trial[index] = b
    const s = tourCost(trial, m, o)
    const before = tourCost(trial.slice(0, index + 1), m, o)
    out.push({
      bar: b, delta: s.cost - base.cost, travelDelta: s.travelMinutes - base.travelMinutes,
      closed: before.closedStops > tourCost(trial.slice(0, index), m, o).closedStops,
    })
  }
  out.sort((a, b) => a.delta - b.delta || richness(b.bar) - richness(a.bar))
  return out.slice(0, limit)
}
