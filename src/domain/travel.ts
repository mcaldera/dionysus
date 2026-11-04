// Travel logic from SPEC section 7. No React or browser APIs in src/domain/.

export const UNREACHABLE = 255

export type Leg =
  | { mode: 'walk'; minutes: number }
  | { mode: 'transit'; minutes: number; usually?: [number, number] }
  | { mode: 'unreachable' }

export interface Matrices {
  n: number
  walk: Uint8Array
  transitP50: Uint8Array
  // Loaded after first render; only used for display.
  transitP25?: Uint8Array
  transitP75?: Uint8Array
}

export function leg(m: Matrices, u: number, v: number, tolerance: number): Leg {
  const i = u * m.n + v
  const w = m.walk[i]
  const t = m.transitP50[i]
  if (w === UNREACHABLE && t === UNREACHABLE) return { mode: 'unreachable' }
  if (t === UNREACHABLE || w <= t + tolerance) return { mode: 'walk', minutes: w }
  if (m.transitP25 && m.transitP75) return { mode: 'transit', minutes: t, usually: [m.transitP25[i], m.transitP75[i]] }
  return { mode: 'transit', minutes: t }
}

export function legMinutes(l: Leg): number {
  return l.mode === 'unreachable' ? Infinity : l.minutes
}

/** "6 Min. zu Fuß", "12 Min. Öffis (meist 10-15)" */
export function legLabel(l: Leg): string {
  if (l.mode === 'unreachable') return 'nicht erreichbar'
  if (l.mode === 'walk') return `${l.minutes} Min. zu Fuß`
  const [lo, hi] = l.usually ?? [l.minutes, l.minutes]
  return lo === hi ? `${l.minutes} Min. Öffis` : `${l.minutes} Min. Öffis (meist ${lo}-${hi})`
}

export function googleMapsDirections(
  from: { lat: number; lon: number },
  to: { lat: number; lon: number },
  l: Leg,
): string {
  const mode = l.mode === 'transit' ? 'transit' : 'walking'
  return `https://www.google.com/maps/dir/?api=1&origin=${from.lat},${from.lon}&destination=${to.lat},${to.lon}&travelmode=${mode}`
}

export function googleMapsPlace(bar: { name: string; address?: string }): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${bar.name} ${bar.address ?? 'Wien'}`)}`
}
