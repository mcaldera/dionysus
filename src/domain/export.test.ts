import { describe, expect, it } from 'vitest'
import { crc32, tourGpx, tourTable, xlsx } from './export'
import type { SlotView } from './tour'
import type { Bar } from './types'

const bar = (i: number, name: string): Bar => ({
  id: `own:e${i}`, matrixIndex: i, name, district: i + 1, lat: 48.2 + i / 100, lon: 16.3 + i / 100, venueType: 'pub_bar',
  weeklyOpen: null, official: [], tags: [], unreviewedTags: [], address: `Gasse ${i}, 10${i}0 Wien`,
})
const slots: SlotView[] = [
  { district: 1, approx: false, afterGap: false, stop: { bar: bar(0, 'Erste & <Beste>'), legIn: null, arrival: 5 * 1440 + 18 * 60, departure: 5 * 1440 + 18 * 60 + 45, closedOnArrival: false } },
  { district: 2, approx: false, afterGap: false, stop: null },
  { district: 3, approx: false, afterGap: true, stop: { bar: bar(2, 'Dritte'), legIn: { mode: 'walk', minutes: 7 }, arrival: 5 * 1440 + 19 * 60, departure: 5 * 1440 + 19 * 60 + 45, closedOnArrival: false } },
]

describe('tour export', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
  })

  it('writes one row per slot, empty slots marked', () => {
    const t = tourTable(slots, [])
    expect(t.rows).toHaveLength(3)
    expect(t.rows[0].slice(0, 4)).toEqual([1, '18:00', '18:45', 'Erste & <Beste>'])
    expect(String(t.rows[1][3])).toContain('offen')
    expect(t.header).toHaveLength(t.widths.length)
  })

  it('builds a zip with the workbook parts', () => {
    const z = xlsx(tourTable(slots, []), 'Seidl-Tour', 'Titel')
    expect([...z.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04])
    const text = new TextDecoder().decode(z)
    for (const part of ['[Content_Types].xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml', 'xl/styles.xml']) expect(text).toContain(part)
    expect(text).toContain('Erste &amp; &lt;Beste&gt;')
  })

  it('writes waypoints, a route and a track per leg', () => {
    const g = tourGpx(slots, [null, null, [[16.3, 48.2], [16.31, 48.21], [16.32, 48.22]]], 'Tour')
    expect(g.match(/<wpt /g)).toHaveLength(2)
    expect(g.match(/<rtept /g)).toHaveLength(2)
    expect(g.match(/<trkpt /g)).toHaveLength(3)
    expect(g).toContain('<name>1. Erste &amp; &lt;Beste&gt;</name>')
  })
})
