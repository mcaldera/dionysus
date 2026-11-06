import { describe, expect, it } from 'vitest'
import { leg, UNREACHABLE, type Matrices } from './travel'

function matrices(walk: number, p25: number, p50: number, p75: number): Matrices {
  // 2 × 2, only the 0 → 1 entry matters.
  const m = (x: number) => Uint8Array.from([0, x, x, 0])
  return { n: 2, walk: m(walk), transitP25: m(p25), transitP50: m(p50), transitP75: m(p75) }
}

describe('leg', () => {
  it('walks when walking is at most `tolerance` minutes slower', () => {
    expect(leg(matrices(15, 8, 10, 13), 0, 1, 5)).toEqual({ mode: 'walk', minutes: 15 })
  })

  it('takes transit when walking is more than `tolerance` minutes slower', () => {
    expect(leg(matrices(16, 8, 10, 13), 0, 1, 5)).toEqual({ mode: 'transit', minutes: 10, usually: [8, 13] })
  })

  it('walks when transit is unreachable', () => {
    expect(leg(matrices(40, UNREACHABLE, UNREACHABLE, UNREACHABLE), 0, 1, 5)).toEqual({ mode: 'walk', minutes: 40 })
  })

  it('takes transit when walking is unreachable', () => {
    expect(leg(matrices(UNREACHABLE, 20, 25, 30), 0, 1, 5).mode).toBe('transit')
  })

  it('reports unreachable when both are', () => {
    expect(leg(matrices(UNREACHABLE, UNREACHABLE, UNREACHABLE, UNREACHABLE), 0, 1, 5)).toEqual({ mode: 'unreachable' })
  })
})

describe('googleMapsPlace', () => {
  it('searches name and address around the bar, at street zoom', async () => {
    const { googleMapsPlace } = await import('./travel')
    const url = googleMapsPlace({ name: 'Espresso Jackie', address: 'Thaliastraße, 1160 Wien', district: 16, lat: 48.212988, lon: 16.310251 })
    expect(url).toBe('https://www.google.com/maps/search/Espresso%20Jackie%2C%20Thaliastra%C3%9Fe%2C%201160%20Wien/@48.212988,16.310251,18z')
    expect(googleMapsPlace({ name: 'X', district: 20, lat: 48.2, lon: 16.3 })).toContain('X%2C%201200%20Wien')
  })

  it('opens the exact place when the place id is known', async () => {
    const { googleMapsPlace } = await import('./travel')
    const url = googleMapsPlace({ name: 'Hera', mapsQuery: 'Café Hera', placeId: 'ChIJabc', district: 9, lat: 48.2, lon: 16.3 })
    expect(url).toBe('https://www.google.com/maps/search/?api=1&query=Caf%C3%A9%20Hera%2C%201090%20Wien&query_place_id=ChIJabc')
  })
})

describe('ridesBack', () => {
  it('flags the same line the other way, not the same line onwards', async () => {
    const { ridesBack } = await import('../routes')
    const ride = (line: string, from: [number, number], to: [number, number]) =>
      ({ segments: [{ kind: 'ride' as const, line, coords: [from, to] }], lines: [line], alternatives: [], parts: [] })
    const inbound = ride('11', [16.30, 48.20], [16.40, 48.20])
    expect(ridesBack(inbound, ride('11', [16.40, 48.20], [16.33, 48.20]))).toBe('11')
    expect(ridesBack(inbound, ride('11', [16.40, 48.20], [16.45, 48.20]))).toBeNull()
    expect(ridesBack(inbound, ride('U1', [16.40, 48.20], [16.33, 48.20]))).toBeNull()
    expect(ridesBack(inbound, null)).toBeNull()
  })
})
