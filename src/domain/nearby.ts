// Beisl-Finder: bars reachable within a time budget from a bar or from any point (home,
// GPS position). No district rule here; this is the general bar guide SPEC 8.4 kept room for.

import { isOpenAt } from './hours'
import { leg, legMinutes, type Leg, type Matrices } from './travel'
import type { Bar } from './types'

export const WALK_M_PER_MIN = 4800 / 60
/** Streets are longer than the straight line; a usual factor for city walking. */
export const DETOUR = 1.3
/** Bars this close to a free point serve as its stand-ins for transit times. */
const ANCHOR_M = 600
const ANCHORS = 4

export interface NearbyOptions {
  maxMinutes: number
  /** false: walking only. */
  transit: boolean
  walkToleranceMinutes: number
  /** Minute of the week you leave; bars known to be closed on arrival are left out. null = don't check. */
  departure: number | null
  /** With departure: also keep bars whose hours are unknown. Default true. */
  includeUnknownHours?: boolean
}

export interface NearbyResult {
  bar: Bar
  minutes: number
  mode: 'walk' | 'transit'
  /** true/false/null (unknown) at arrival. */
  open: boolean | null
}

export function metres(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const k = Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180)
  return Math.hypot((b.lat - a.lat) * 111_320, (b.lon - a.lon) * 111_320 * k)
}

/** Walking estimate between two points: straight line times the detour factor. */
export function walkEstimate(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  return Math.round((metres(a, b) * DETOUR) / WALK_M_PER_MIN)
}

function finish(found: Map<string, { bar: Bar; minutes: number; mode: 'walk' | 'transit' }>, o: NearbyOptions): NearbyResult[] {
  const out: NearbyResult[] = []
  for (const f of found.values()) {
    if (f.minutes > o.maxMinutes) continue
    const open = o.departure === null ? null : isOpenAt(f.bar.weeklyOpen, o.departure + f.minutes)
    if (open === false || (open === null && o.departure !== null && o.includeUnknownHours === false)) continue
    out.push({ ...f, open })
  }
  return out.sort((a, b) => a.minutes - b.minutes || a.bar.name.localeCompare(b.bar.name))
}

function legOrWalk(m: Matrices, u: number, v: number, o: NearbyOptions): Leg {
  if (o.transit) return leg(m, u, v, o.walkToleranceMinutes)
  const w = m.walk[u * m.n + v]
  return w === 255 ? { mode: 'unreachable' } : { mode: 'walk', minutes: w }
}

/** Bars within the budget from a bar, any district. */
export function nearbyFromBar(from: Bar, bars: Bar[], m: Matrices, o: NearbyOptions): NearbyResult[] {
  const found = new Map<string, { bar: Bar; minutes: number; mode: 'walk' | 'transit' }>()
  for (const b of bars) {
    if (b.id === from.id) continue
    const l = legOrWalk(m, from.matrixIndex, b.matrixIndex, o)
    if (l.mode === 'unreachable') continue
    found.set(b.id, { bar: b, minutes: legMinutes(l), mode: l.mode })
  }
  return finish(found, o)
}

/**
 * Bars within the budget from a free point. Walking: straight-line estimate. With transit:
 * also walk to one of the nearest bars and take its travel times from there.
 */
export function nearbyFromPoint(p: { lat: number; lon: number }, bars: Bar[], m: Matrices, o: NearbyOptions): NearbyResult[] {
  const found = new Map<string, { bar: Bar; minutes: number; mode: 'walk' | 'transit' }>()
  for (const b of bars) {
    const w = walkEstimate(p, b)
    if (w <= o.maxMinutes) found.set(b.id, { bar: b, minutes: w, mode: 'walk' })
  }
  if (o.transit) {
    const anchors = bars.map((b) => ({ b, d: metres(p, b) })).filter((x) => x.d <= ANCHOR_M)
      .sort((x, y) => x.d - y.d).slice(0, ANCHORS)
    for (const { b: a } of anchors) {
      const start = walkEstimate(p, a)
      for (const b of bars) {
        const l = legOrWalk(m, a.matrixIndex, b.matrixIndex, o)
        if (l.mode === 'unreachable') continue
        const t = start + l.minutes
        const cur = found.get(b.id)
        if (!cur || t < cur.minutes) found.set(b.id, { bar: b, minutes: t, mode: l.mode === 'transit' ? 'transit' : 'walk' })
      }
    }
  }
  return finish(found, o)
}
