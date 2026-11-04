// Messages between the app and the solver worker. Bars travel as IDs after `init`.

import type { SolveOptions } from '../domain/solver'
import type { Matrices } from '../domain/travel'
import type { Bar } from '../domain/types'

export type SolveRequest = Omit<SolveOptions, 'prefix' | 'pinned'> & { prefix: string[]; pinned: string[] }

export type WorkerRequest =
  | { type: 'init'; bars: Bar[]; matrices: Matrices }
  | { type: 'propose'; id: number; options: SolveRequest; count: number }
  | { type: 'solve'; id: number; options: SolveRequest }
  | { type: 'complete'; id: number; options: SolveRequest; slots: { district: number; barId: string | null }[] }
  | { type: 'tourFit'; id: number; options: SolveRequest; candidates: string[] }

export interface TourResult {
  stops: string[]
  cost: number
  travelMinutes: number
  closedStops: number
  missing: number[]
}

export type JobResult =
  | { type: 'progress'; id: number; done: number; total: number }
  | { type: 'fit'; id: number; barId: string; extra: number }
  | { type: 'tours'; id: number; tours: TourResult[] }
