// Paths for drawing legs, fetched on demand and kept in memory:
// - walking from the FOSSGIS OSRM server (routing.openstreetmap.de)
// - public transport from Transitous (api.transitous.org, MOTIS 2), only for tour legs and the
//   previewed leg, so requests stay few. Travel times still come from our own matrices.

import { DAY } from './domain/hours'

type Coords = [number, number][]

const walkCache = new Map<string, Promise<Coords | null>>()

export function walkingPath(a: { lat: number; lon: number }, b: { lat: number; lon: number }): Promise<Coords | null> {
  const key = `${a.lon.toFixed(5)},${a.lat.toFixed(5)};${b.lon.toFixed(5)},${b.lat.toFixed(5)}`
  let p = walkCache.get(key)
  if (!p) {
    p = fetch(`https://routing.openstreetmap.de/routed-foot/route/v1/driving/${key}?overview=full&geometries=geojson`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => (d?.routes?.[0]?.geometry?.coordinates as Coords) ?? null)
      .catch(() => null)
    walkCache.set(key, p)
  }
  return p
}

export interface RouteSegment {
  coords: Coords
  /** walk: on foot within a transit trip; ride: on a vehicle. */
  kind: 'walk' | 'ride'
  /** Line colour as #rrggbb. */
  color?: string
  /** Line name, e.g. "U3" or "13A". */
  line?: string
}

export interface TransitRoute {
  segments: RouteSegment[]
  /** Lines in order, e.g. ["U3", "U1"]. */
  lines: string[]
  /** Other line sequences of similar duration, depending on when you leave. */
  alternatives: string[][]
  /** Minutes per MOTIS mode (WALK, SUBWAY, TRAM, BUS, ...), in order, for statistics. */
  parts: { mode: string; minutes: number }[]
}

// Wiener Linien colours when the feed has none (buses and trams usually don't).
const MODE_COLOR: Record<string, string> = {
  SUBWAY: '#e3000f', TRAM: '#c4161c', BUS: '#1d4f91', COACH: '#1d4f91',
  RAIL: '#0f6cb6', SUBURBAN: '#0f6cb6', REGIONAL_RAIL: '#0f6cb6', METRO: '#0f6cb6',
}

/** Google-style encoded polyline with the given precision; returns [lon, lat]. */
export function decodePolyline(s: string, precision: number): Coords {
  const f = 10 ** precision
  const out: Coords = []
  let i = 0
  let lat = 0
  let lon = 0
  const next = () => {
    let shift = 0
    let result = 0
    let b: number
    do {
      b = s.charCodeAt(i++) - 63
      result |= (b & 0x1f) << shift
      shift += 5
    } while (b >= 0x20)
    return result & 1 ? ~(result >> 1) : result >> 1
  }
  while (i < s.length) {
    lat += next()
    lon += next()
    out.push([lon / f, lat / f])
  }
  return out
}

/** The next date (from tomorrow on) with this weekday (0 = Monday), at this minute of the day, as UTC ISO. */
export function nextDeparture(minuteOfWeek: number, now = new Date()): string {
  const weekday = Math.floor(minuteOfWeek / DAY) % 7
  const minute = minuteOfWeek - Math.floor(minuteOfWeek / DAY) * DAY
  const today = (now.getDay() + 6) % 7
  const ahead = ((weekday - today + 7) % 7) || 7
  const y = now.getFullYear()
  const mo = now.getMonth()
  const d = now.getDate() + ahead
  // Vienna local time to UTC: guess +1 h, then correct with the real offset at that instant.
  const local = Date.UTC(y, mo, d, 0, minute)
  const offset = viennaOffsetMinutes(new Date(local - 60 * 60_000))
  return new Date(local - offset * 60_000).toISOString()
}

function viennaOffsetMinutes(at: Date): number {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Vienna', timeZoneName: 'shortOffset' })
    .formatToParts(at).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+1'
  const m = /GMT([+-])(\d+)(?::(\d+))?/.exec(name)
  if (!m) return 60
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0))
}

interface MotisLeg {
  mode: string
  duration: number
  routeShortName?: string
  displayName?: string
  routeColor?: string
  legGeometry: { points: string; precision: number }
}

interface MotisItinerary {
  duration: number
  legs: MotisLeg[]
}

function lineName(l: MotisLeg): string {
  return l.routeShortName || l.displayName || l.mode
}

/** Pick the shortest itinerary; list others of similar duration that use different lines. */
export function chooseRoute(itineraries: MotisItinerary[], slackSeconds = 5 * 60): TransitRoute | null {
  const rides = itineraries.filter((it) => it.legs.some((l) => l.mode !== 'WALK'))
  if (!rides.length) return null
  const best = rides.reduce((a, b) => (b.duration < a.duration ? b : a))
  const lines = (it: MotisItinerary) => it.legs.filter((l) => l.mode !== 'WALK').map(lineName)
  const chosen = lines(best)
  const seen = new Set([chosen.join('>')])
  const alternatives: string[][] = []
  for (const it of [...rides].sort((a, b) => a.duration - b.duration)) {
    const ls = lines(it)
    const key = ls.join('>')
    if (it.duration > best.duration + slackSeconds || seen.has(key)) continue
    seen.add(key)
    alternatives.push(ls)
  }
  return {
    lines: chosen,
    alternatives: alternatives.slice(0, 2),
    parts: best.legs.map((l) => ({ mode: l.mode, minutes: l.duration / 60 })),
    segments: best.legs.map((l) => {
      const coords = decodePolyline(l.legGeometry.points, l.legGeometry.precision)
      if (l.mode === 'WALK') return { coords, kind: 'walk' as const }
      const color = l.routeColor ? `#${l.routeColor}` : MODE_COLOR[l.mode] ?? '#c4161c'
      return { coords, kind: 'ride' as const, color, line: lineName(l) }
    }),
  }
}

const transitCache = new Map<string, Promise<TransitRoute | null>>()

// At most two requests in flight, so a fresh tour doesn't hit the server with 20 at once.
const MAX_IN_FLIGHT = 2
let inFlight = 0
const queue: (() => void)[] = []

async function limited<T>(task: () => Promise<T>): Promise<T> {
  if (inFlight >= MAX_IN_FLIGHT) await new Promise<void>((resolve) => queue.push(resolve))
  inFlight++
  try {
    return await task()
  } finally {
    inFlight--
    queue.shift()?.()
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** The plan response; retries on rate limits, server and network errors, throws if they persist. */
async function fetchPlan(url: string): Promise<{ itineraries?: MotisItinerary[] }> {
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fetch(url)
      if (r.ok) return await r.json()
      if (r.status !== 429 && r.status < 500) return {}
    } catch (e) {
      if (attempt >= 2) throw e
    }
    if (attempt >= 2) throw new Error('transit routing unavailable')
    await sleep(1500 * 2 ** attempt)
  }
}

/**
 * Transit route from a to b, leaving at the given minute of the week (rounded to 15 minutes).
 * Resolves to null if there is no transit connection; rejects if the server can't be reached,
 * and then forgets the request so a later call tries again.
 */
export function transitPath(
  a: { lat: number; lon: number }, b: { lat: number; lon: number }, minuteOfWeek: number,
): Promise<TransitRoute | null> {
  const minute = Math.round(minuteOfWeek / 15) * 15
  const key = `${a.lat.toFixed(5)},${a.lon.toFixed(5)};${b.lat.toFixed(5)},${b.lon.toFixed(5)};${minute}`
  let p = transitCache.get(key)
  if (!p) {
    const q = new URLSearchParams({
      fromPlace: `${a.lat},${a.lon}`, toPlace: `${b.lat},${b.lon}`, time: nextDeparture(minute), numItineraries: '5',
    })
    p = limited(() => fetchPlan(`https://api.transitous.org/api/v1/plan?${q}`))
      .then((d) => (d.itineraries ? chooseRoute(d.itineraries) : null))
    p.catch(() => transitCache.delete(key))
    transitCache.set(key, p)
  }
  return p
}

/** Direction of a ride segment, x scaled for latitude; null if it has fewer than two points. */
function rideDir(seg: RouteSegment): [number, number] | null {
  const a = seg.coords[0]
  const b = seg.coords[seg.coords.length - 1]
  if (!a || !b) return null
  const x = (b[0] - a[0]) * Math.cos((a[1] * Math.PI) / 180)
  const y = b[1] - a[1]
  const n = Math.hypot(x, y)
  return n ? [x / n, y / n] : null
}

/**
 * The line ridden back, if the leg out of a stop starts on the same line the leg into it ended
 * on, heading the other way (more than about 110° apart); else null. Going on in the same
 * direction on the same line is fine.
 */
export function ridesBack(into: TransitRoute | null | undefined, out: TransitRoute | null | undefined): string | null {
  const a = into?.segments.filter((s) => s.kind === 'ride').at(-1)
  const b = out?.segments.find((s) => s.kind === 'ride')
  if (!a || !b || !a.line || a.line !== b.line) return null
  const da = rideDir(a)
  const db = rideDir(b)
  if (!da || !db) return null
  return da[0] * db[0] + da[1] * db[1] < -0.35 ? a.line : null
}
