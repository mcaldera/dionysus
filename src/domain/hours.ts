// Opening hours as weekly intervals in minutes from Monday 00:00 (SPEC 5.6).

export const DAY = 24 * 60
export const WEEK = 7 * DAY

export const WEEKDAYS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag']

/** true / false, or null when the hours are unknown. */
export function isOpenAt(weekly: [number, number][] | null, minuteOfWeek: number): boolean | null {
  if (weekly === null) return null
  const m = ((minuteOfWeek % WEEK) + WEEK) % WEEK
  // Intervals may end after Sunday midnight, so also test one week later.
  return weekly.some(([a, b]) => (a <= m && m < b) || (a <= m + WEEK && m + WEEK < b))
}

/** "14:05", wrapping past midnight. */
export function clock(minutes: number): string {
  const m = ((Math.round(minutes) % DAY) + DAY) % DAY
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/** "5 h 40", "35 Min." */
export function duration(minutes: number): string {
  const m = Math.round(minutes)
  if (m < 60) return `${m} Min.`
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`
}

/** If open at the given minute, the minute of the week when that opening ends. */
export function openUntil(weekly: [number, number][] | null, minuteOfWeek: number): number | null {
  if (!weekly) return null
  const m = ((minuteOfWeek % WEEK) + WEEK) % WEEK
  for (const [a, b] of weekly) {
    if (a <= m && m < b) return b
    if (a <= m + WEEK && m + WEEK < b) return b - WEEK
  }
  return null
}
