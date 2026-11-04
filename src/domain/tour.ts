// A single-day tour timeline. The solver and multi-day plans come in Phases 5 and 6.

import { DAY, isOpenAt } from './hours'
import { leg, legMinutes, type Leg, type Matrices } from './travel'
import type { Bar } from './types'

export interface TimelineStop {
  bar: Bar
  /** Leg from the previous stop; null for the first stop. */
  legIn: Leg | null
  /** Minutes from Monday 00:00 of the plan's week. */
  arrival: number
  departure: number
  closedOnArrival: boolean
}

export function timeline(
  stops: Bar[], matrices: Matrices, weekday: number, startMinutes: number, stopMinutes: number, tolerance: number,
): TimelineStop[] {
  const out: TimelineStop[] = []
  let t = weekday * DAY + startMinutes
  stops.forEach((bar, i) => {
    const legIn = i === 0 ? null : leg(matrices, stops[i - 1].matrixIndex, bar.matrixIndex, tolerance)
    if (legIn) t += legMinutes(legIn)
    const arrival = t
    t += stopMinutes
    out.push({ bar, legIn, arrival, departure: t, closedOnArrival: isOpenAt(bar.weeklyOpen, arrival) === false })
  })
  return out
}
