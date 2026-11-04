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

export interface SlotView {
  district: number
  /** null for an empty slot. */
  stop: TimelineStop | null
  /** An empty slot comes earlier, so this time leaves out at least one stop. */
  approx: boolean
  /** The slot before is empty: legIn skips it and isn't shown. */
  afterGap: boolean
}

/** Timeline over the filled slots, mapped back onto all slots (empty ones keep their place). */
export function slotTimeline(
  slots: { district: number; bar: Bar | null }[], matrices: Matrices, weekday: number, startMinutes: number,
  stopMinutes: number, tolerance: number,
): SlotView[] {
  const filled = slots.flatMap((s) => (s.bar ? [s.bar] : []))
  const tl = timeline(filled, matrices, weekday, startMinutes, stopMinutes, tolerance)
  let k = 0
  let gapSeen = false
  return slots.map((s, i) => {
    const stop = s.bar ? tl[k++] : null
    const view = { district: s.district, stop, approx: gapSeen && !!stop, afterGap: i > 0 && !slots[i - 1].bar }
    if (!s.bar) gapSeen = true
    return view
  })
}
