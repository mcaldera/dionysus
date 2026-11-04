// Runs the solver off the main thread (SPEC 9). Jobs are cancelled by terminating the
// worker, see client.ts, because the solve loops are synchronous.

/// <reference lib="webworker" />
import { proposeTours, solve, type Solution } from '../domain/solver'
import type { Matrices } from '../domain/travel'
import type { Bar } from '../domain/types'
import type { JobResult, WorkerRequest } from './protocol'

let bars: Bar[] = []
let byId = new Map<string, Bar>()
let matrices: Matrices | null = null

function ids(s: Solution) {
  return { stops: s.stops.map((b) => b.id), cost: s.cost, travelMinutes: s.travelMinutes, closedStops: s.closedStops, missing: s.missing }
}

function post(msg: JobResult) {
  self.postMessage(msg)
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data
  if (msg.type === 'init') {
    bars = msg.bars
    byId = new Map(bars.map((b) => [b.id, b]))
    matrices = msg.matrices
    return
  }
  if (!matrices) return
  const m = matrices
  const o = {
    ...msg.options,
    prefix: msg.options.prefix.map((id) => byId.get(id)).filter((b): b is Bar => !!b),
    pinned: msg.options.pinned.map((id) => byId.get(id)).filter((b): b is Bar => !!b),
  }
  if (msg.type === 'propose') {
    const tours = proposeTours(bars, m, o, msg.count, (done, total) => {
      post({ type: 'progress', id: msg.id, done, total })
      return true
    })
    post({ type: 'tours', id: msg.id, tours: tours.map(ids) })
  } else if (msg.type === 'solve') {
    const s = solve(bars, m, o)
    post({ type: 'tours', id: msg.id, tours: s ? [ids(s)] : [] })
  } else if (msg.type === 'tourFit') {
    // extra = best remaining tour via v − best remaining tour overall (SPEC 8.2).
    const base = solve(bars, m, { ...o, restarts: 1 })
    if (!base) return
    for (const id of msg.candidates) {
      const v = byId.get(id)
      if (!v) continue
      const s = solve(bars, m, { ...o, prefix: [...o.prefix, v], restarts: 1 })
      if (s) post({ type: 'fit', id: msg.id, barId: id, extra: s.cost - base.cost })
    }
    post({ type: 'tours', id: msg.id, tours: [] })
  }
}
