import { clock, duration } from '../domain/hours'
import type { TimelineStop } from '../domain/tour'
import { googleMapsDirections, legLabel } from '../domain/travel'
import { TYPE_COLOR, TYPE_ICON } from '../theme'

interface Props {
  stops: TimelineStop[]
  districtCount: number
  onSelect: (id: string) => void
  onRemove: (id: string) => void
}

export default function TourPanel({ stops, districtCount, onSelect, onRemove }: Props) {
  const total = stops.length ? stops[stops.length - 1].departure - stops[0].arrival : 0
  const pct = Math.round((stops.length / districtCount) * 100)
  return (
    <section className="card" aria-label="Eure Tour">
      <div className="card-head">
        <h3>Eure Tour</h3>
        {stops.length > 0 && <span className="totals">{stops.length} von {districtCount} Bezirken · {duration(total)}</span>}
      </div>
      <div className="progress" aria-hidden="true"><span style={{ width: `${pct}%` }} /></div>
      {stops.length === 0 ? (
        <p className="hint">Noch keine Lokale. Wählt eines aus und klickt „Zur Tour hinzufügen“.</p>
      ) : (
        <ol className="timeline">
          {stops.map((s, i) => (
            <li key={s.bar.id}>
              {s.legIn && (
                <div className={`leg ${s.legIn.mode}`}>
                  <span>{s.legIn.mode === 'walk' ? '🚶' : '🚋'} {legLabel(s.legIn)}</span>
                  <a href={googleMapsDirections(stops[i - 1].bar, s.bar, s.legIn)} target="_blank" rel="noreferrer">Route ↗</a>
                </div>
              )}
              <div className="stop">
                <span className="time">{clock(s.arrival)}</span>
                <span className="stop-dot" style={{ background: TYPE_COLOR[s.bar.venueType] }}>{i + 1}</span>
                <button type="button" className="link stop-name" onClick={() => onSelect(s.bar.id)}>
                  {s.bar.name} <span className="muted">{TYPE_ICON[s.bar.venueType]} {s.bar.district}.</span>
                </button>
                <button type="button" className="icon-btn" aria-label={`${s.bar.name} entfernen`} onClick={() => onRemove(s.bar.id)}>×</button>
              </div>
              {s.closedOnArrival && <div className="warn small">⚠ Bei Ankunft geschlossen</div>}
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
