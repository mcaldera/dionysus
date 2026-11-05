// Complete tours proposed by the solver. Hovering one previews it on the map.

import { duration } from '../domain/hours'
import type { TimelineStop } from '../domain/tour'
import type { Participant } from '../domain/types'
import { match } from '../domain/recommend'
import Icon from './Icon'

export interface ProposalState {
  title: string
  running: boolean
  progress: number
  tours: TimelineStop[][]
}

interface Props {
  state: ProposalState
  participants: Participant[]
  districtName: (d: number) => string
  active: number
  onHover: (i: number) => void
  onApply: (i: number) => void
  onClose: () => void
}

export default function Proposals({ state, participants, districtName, active, onHover, onApply, onClose }: Props) {
  return (
    <section className="card" aria-label="Tourvorschläge">
      <div className="card-head">
        <h3>{state.title}</h3>
        <button type="button" className="icon-btn" aria-label="Vorschläge schließen" onClick={onClose}><Icon name="x" size={18} /></button>
      </div>
      {state.running && (
        <>
          <p className="hint"><span className="spinner small-spin" /> Rechne Touren durch …</p>
          <div className="progress"><span style={{ width: `${Math.round(state.progress * 100)}%` }} /></div>
        </>
      )}
      {!state.running && state.tours.length === 0 && <p className="hint">Keine Tour gefunden. Filter lockern?</p>}
      <ol className="proposals">
        {state.tours.map((tl, i) => {
          const first = tl[0]
          const last = tl[tl.length - 1]
          const walks = tl.filter((s) => s.legIn?.mode === 'walk').length
          const rides = tl.filter((s) => s.legIn?.mode === 'transit').length
          const travel = tl.reduce((a, s) => a + (s.legIn && s.legIn.mode !== 'unreachable' ? s.legIn.minutes : 0), 0)
          const closed = tl.filter((s) => s.closedOnArrival).length
          const liked = participants.length ? tl.filter((s) => match(s.bar, participants) > 0).length : null
          return (
            <li key={tl.map((s) => s.bar.id).join()}>
              <div className={`proposal${i === active ? ' active' : ''}`} onMouseEnter={() => onHover(i)}>
                <div className="proposal-route">
                  <span className="rank">{i + 1}</span>
                  <span>
                    <strong>{districtName(first.bar.district)}</strong> → <strong>{districtName(last.bar.district)}</strong>
                    <span className="muted small"> · {tl.length} Lokale</span>
                  </span>
                </div>
                <div className="proposal-stats">
                  <span title="Von der Ankunft im ersten bis zum Aufbruch aus dem letzten Lokal"><Icon name="timer" size={13} /> {duration(last.departure - first.arrival)}</span>
                  <span title="Reine Wegzeit"><Icon name="compass" size={13} /> {duration(travel)} unterwegs</span>
                  <span><Icon name="walk" size={13} /> {walks} · <Icon name="tram" size={13} /> {rides}</span>
                  {liked !== null && <span className="liked-count"><Icon name="heart" size={12} filled /> {liked} passend</span>}
                  {closed > 0 && <span className="warn"><Icon name="warn" size={13} /> {closed} zu</span>}
                </div>
                <button type="button" className="primary small-btn" onClick={() => onApply(i)}>Übernehmen</button>
              </div>
            </li>
          )
        })}
      </ol>
      {state.tours.length > 0 && (
        <p className="hint small">Danach könnt ihr jedes Lokal tauschen oder fixieren und neu optimieren.</p>
      )}
    </section>
  )
}
