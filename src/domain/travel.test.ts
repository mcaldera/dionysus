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
