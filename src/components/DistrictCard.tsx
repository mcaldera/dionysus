// Figures for a clicked district, in the side panel so the map stays free.

import type { DistrictStats } from '../domain/districtStats'
import { TAG_LABEL, type Tag } from '../domain/types'
import { TYPE_COLOR, TYPE_SHORT } from '../theme'
import Icon, { TypeIcon } from './Icon'

interface Props {
  name: string
  stats: DistrictStats
  /** "jetzt" or "Sa 11:00", for the open share. */
  atLabel: string
  onPick: (id: string) => void
  onClose: () => void
}

const SHOWN_TAGS: Tag[] = ['essen', 'gastgarten', 'lang_offen', 'urig', 'live_musik']

function pct(x: number): string {
  return `${Math.round(x * 100)} %`
}

export default function DistrictCard({ name, stats: s, atLabel, onPick, onClose }: Props) {
  const max = Math.max(1, ...s.byType.map((t) => t.count))
  return (
    <section className="card district-card district-float" aria-label={`Bezirk ${name}`}>
      <div className="card-head">
        <h3>{name}</h3>
        <button type="button" className="icon-btn" aria-label="Bezirk schließen" onClick={onClose}><Icon name="x" size={16} /></button>
      </div>
      <div className="stat-tiles">
        <div><strong>{s.count}</strong><span>Lokale</span></div>
        <div><strong>{s.perKm2.toFixed(s.perKm2 < 10 ? 1 : 0)}</strong><span>pro km² ({s.areaKm2.toFixed(1)} km²)</span></div>
        <div><strong>{pct(s.openShare)}</strong><span>offen {atLabel}</span></div>
        <div><strong>{s.tippedCount || '–'}</strong><span>mit Tipp</span></div>
      </div>
      <h4>Lokaltypen</h4>
      <ul className="type-bars">
        {s.byType.map((t) => (
          <li key={t.type}>
            <span className="type-bar-label"><TypeIcon type={t.type} /> {TYPE_SHORT[t.type]}</span>
            <span className="type-bar-track"><span style={{ width: `${(t.count / max) * 100}%`, background: TYPE_COLOR[t.type] }} /></span>
            <span className="type-bar-value">{t.count} <span className="muted">· {pct(t.count / s.count)}</span></span>
          </li>
        ))}
      </ul>
      <h4>Wege</h4>
      <ul className="facts-list">
        {s.medianNearestWalk !== null && (
          <li title="Für jedes Lokal der Fußweg zum nächstgelegenen anderen; der typische Wert">
            <Icon name="walk" size={13} /> Bis zum nächsten Lokal meist <strong>{s.medianNearestWalk} Min.</strong>
          </li>
        )}
        {s.medianPairWalk !== null && (
          <li title="Fußweg zwischen zwei beliebigen Lokalen des Bezirks; der typische Wert">
            <Icon name="walk" size={13} /> Quer durch den Bezirk meist <strong>{s.medianPairWalk} Min.</strong>
          </li>
        )}
      </ul>
      <h4>Merkmale</h4>
      <div className="chips">
        {SHOWN_TAGS.filter((t) => s.tagCounts[t]).map((t) => <span key={t} className="chip">{TAG_LABEL[t]} · {s.tagCounts[t]}</span>)}
        {s.unknownShare > 0 && <span className="chip muted">{pct(s.unknownShare)} ohne Öffnungszeiten</span>}
      </div>
      {s.tipped.length > 0 && (
        <>
          <h4>Empfohlen</h4>
          <ul className="fav-list">
            {s.tipped.map((b) => (
              <li key={b.id}><button type="button" className="link" onClick={() => onPick(b.id)}>{b.name}</button></li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
