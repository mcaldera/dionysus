import { describe, expect, it } from 'vitest'
import { decodeMine, encodeMine } from './mine'

describe('Meine Lokale links', () => {
  it('round-trips OSM and own IDs', () => {
    const ids = ['osm:node/46823888', 'osm:way/12', 'osm:relation/7', 'own:gasthaus']
    expect(encodeMine(ids)).toBe('meine=n46823888.w12.r7.own%3Agasthaus')
    expect(decodeMine(`#${encodeMine(ids)}`)).toEqual(ids)
  })

  it('ignores hashes without a list and drops duplicates', () => {
    expect(decodeMine('#plan=abc')).toBeNull()
    expect(decodeMine('')).toBeNull()
    expect(decodeMine('#x=1&meine=n1.n1.')).toEqual(['osm:node/1'])
  })
})
