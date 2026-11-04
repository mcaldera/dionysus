// Parse OSM opening_hours into weekly intervals (SPEC 5.6).
//
// Output: data/interim/opening_hours.json, { [barId]: { weeklyOpen, warning? } }
//   weeklyOpen: [start, end] minutes from Monday 00:00, end may exceed a day for
//   intervals crossing midnight; null = unknown; [] = known closed all week.
//
// Seasonal rules (e.g. "Apr-Sep ...") are evaluated for a reference week in
// November 2026, the week of the travel-time matrices. Public holidays are ignored.
//
// Run: TZ=Europe/Vienna node pipeline/05_opening_hours.mjs

import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const OpeningHours = require('opening_hours')

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const WEEK_START = new Date(2026, 10, 9) // Monday 9 November 2026, local time
const WEEK_MINUTES = 7 * 24 * 60
const NOMINATIM = { lat: 48.2, lon: 16.37, address: { country_code: 'at', state: 'Wien' } }

if (Intl.DateTimeFormat().resolvedOptions().timeZone !== 'Europe/Vienna') {
  console.error('Run with TZ=Europe/Vienna')
  process.exit(1)
}

function minutesFromWeekStart(d) {
  return Math.round((d - WEEK_START) / 60000)
}

function parse(text) {
  // Week plus one day, so Sunday-night intervals end at their real closing time.
  const oh = new OpeningHours(text, NOMINATIM, { mode: 0, warnings_severity: 0 })
  const end = new Date(WEEK_START.getTime() + 8 * 24 * 3600 * 1000)
  const intervals = []
  for (const [from, to] of oh.getOpenIntervals(WEEK_START, end)) {
    const a = minutesFromWeekStart(from)
    const b = minutesFromWeekStart(to)
    if (a >= WEEK_MINUTES) break
    // Skip the spill-over at Monday 00:00 from the Sunday before: the same interval
    // appears again at the end of the week, where it continues past midnight.
    if (a === 0 && intervals.length === 0 && opensSundayNight(oh)) continue
    const last = intervals[intervals.length - 1]
    if (last && last[1] >= a) last[1] = Math.max(last[1], b)
    else intervals.push([a, b])
  }
  return intervals
}

function opensSundayNight(oh) {
  // Open at Sunday 23:59 of the reference week means Monday 00:00 is a continuation.
  return oh.getState(new Date(WEEK_START.getTime() + WEEK_MINUTES * 60000 - 60000))
}

const bars = JSON.parse(readFileSync(join(ROOT, 'data/interim/bars.json'), 'utf8')).bars
const out = {}
const counts = { parsed: 0, unknown: 0, failed: 0, closedAllWeek: 0 }
for (const b of bars) {
  if (!b.openingHoursText) {
    out[b.id] = { weeklyOpen: null }
    counts.unknown++
    continue
  }
  try {
    const weeklyOpen = parse(b.openingHoursText)
    out[b.id] = { weeklyOpen }
    counts.parsed++
    if (weeklyOpen.length === 0) counts.closedAllWeek++
  } catch (e) {
    out[b.id] = { weeklyOpen: null, warning: String(e).slice(0, 200) }
    counts.failed++
  }
}
writeFileSync(join(ROOT, 'data/interim/opening_hours.json'), JSON.stringify(out))
console.log(counts)
