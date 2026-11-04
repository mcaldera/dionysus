import { describe, expect, it } from 'vitest'
import { matchesFilter, strongTips, tipKinds, tipLabel, type MapFilter } from './filter'
import { VENUE_TYPES, type Bar } from './types'

function bar(tips: Bar['tips']): Bar {
  return {
    id: 'own:x', matrixIndex: 0, name: 'X', district: 1, lat: 48.2, lon: 16.37, venueType: 'pub_bar',
    weeklyOpen: null, official: [], tags: [], unreviewedTags: [], tips,
  }
}

const filter: MapFilter = { venueTypes: new Set(VENUE_TYPES), tags: new Set(), sources: new Set(), tipKinds: new Set(), weakTips: false, openAt: null, includeUnknownHours: true }

describe('recommendation kinds', () => {
  it('maps older list kinds onto the shared ones', () => {
    const b = bar([{ source: 'Falter Lokalführer: Biertrinken', url: 'u', kind: 'bier' }, { source: '1000things', url: 'u', kind: 'beisl' }])
    expect([...tipKinds(b, false)].sort()).toEqual(['bier', 'urig'])
  })

  it('counts single forum mentions only when asked', () => {
    const b = bar([{ source: 'r/wien', url: 'u', kind: 'rau', strength: 'erwähnt', threads: 1 }])
    expect(strongTips(b)).toHaveLength(0)
    expect(matchesFilter(b, { ...filter, tipKinds: new Set(['rau']) })).toBe(false)
    expect(matchesFilter(b, { ...filter, tipKinds: new Set(['rau']), weakTips: true })).toBe(false)
    expect(matchesFilter(b, { ...filter, tipKinds: new Set(['rau']), sources: new Set(['forum']), weakTips: true })).toBe(true)
  })

  it('keeps urig and rau apart', () => {
    const b = bar([{ source: 'r/wien', url: 'u', kind: 'urig', strength: 'stark', threads: 3 }])
    expect(matchesFilter(b, { ...filter, tipKinds: new Set(['rau']) })).toBe(false)
    expect(matchesFilter(b, { ...filter, tipKinds: new Set(['urig']) })).toBe(true)
    expect(tipLabel(b.tips![0])).toBe('r/wien · urig & klassisch')
  })
})
