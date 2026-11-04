// One solver worker per channel. Starting a job cancels the channel's running job by
// terminating its worker and starting a fresh one (SPEC 8.3: cancel when another bar is clicked).

import type { Matrices } from '../domain/travel'
import type { Bar } from '../domain/types'
import type { JobResult, SolveRequest, TourResult, WorkerRequest } from './protocol'

type Job =
  | { type: 'propose'; options: SolveRequest; count: number }
  | { type: 'solve'; options: SolveRequest }
  | { type: 'tourFit'; options: SolveRequest; candidates: string[] }

export interface JobHandlers {
  onProgress?: (done: number, total: number) => void
  onFit?: (barId: string, extra: number) => void
}

export class SolverChannel {
  private worker: Worker | null = null
  private busy = false
  private nextId = 1
  private reject: ((e: Error) => void) | null = null

  private readonly bars: Bar[]
  private readonly matrices: Matrices

  constructor(bars: Bar[], matrices: Matrices) {
    this.bars = bars
    this.matrices = matrices
  }

  private fresh(): Worker {
    if (this.worker && !this.busy) return this.worker
    this.worker?.terminate()
    this.reject?.(new CancelledError())
    const w = new Worker(new URL('./solver.worker.ts', import.meta.url), { type: 'module' })
    w.postMessage({ type: 'init', bars: this.bars, matrices: this.matrices } satisfies WorkerRequest)
    this.worker = w
    return w
  }

  run(job: Job, handlers: JobHandlers = {}): Promise<TourResult[]> {
    const w = this.fresh()
    const id = this.nextId++
    this.busy = true
    return new Promise((resolve, reject) => {
      this.reject = reject
      w.onmessage = (e: MessageEvent<JobResult>) => {
        const msg = e.data
        if (msg.id !== id) return
        if (msg.type === 'progress') handlers.onProgress?.(msg.done, msg.total)
        else if (msg.type === 'fit') handlers.onFit?.(msg.barId, msg.extra)
        else {
          this.busy = false
          this.reject = null
          resolve(msg.tours)
        }
      }
      w.onerror = (e) => {
        this.busy = false
        this.reject = null
        reject(new Error(e.message))
      }
      w.postMessage({ ...job, id } as WorkerRequest)
    })
  }

  cancel() {
    if (!this.busy) return
    this.worker?.terminate()
    this.worker = null
    this.busy = false
    this.reject?.(new CancelledError())
    this.reject = null
  }

  dispose() {
    this.cancel()
    this.worker?.terminate()
    this.worker = null
  }
}

export class CancelledError extends Error {
  constructor() {
    super('cancelled')
  }
}
