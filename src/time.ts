// The current time in Vienna as minute of the week (0 = Monday 00:00), whatever the
// browser's time zone.

import { DAY } from './domain/hours'

export function nowMinuteOfWeek(now = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Vienna', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  const day = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(get('weekday'))
  return Math.max(0, day) * DAY + Number(get('hour')) * 60 + Number(get('minute'))
}
