// Statistics of the planned tour, shown in place of the start card once a tour exists.

import { clock, duration } from '../domain/hours'
import type { SlotView } from '../domain/tour'
import { TAG_LABEL, TAGS, VENUE_TYPES, type Tag } from '../domain/types'
import type { TransitRoute } from '../routes'
import { TYPE_COLOR, TYPE_SHORT } from '../theme'
import Icon, { TypeIcon } from './Icon'

// Travel modes in a fixed order; colours checked with the dataviz palette validator
// (adjacent pairs separable under colour-vision deficiency). Unknown is grey with hatching.
const MODES = [
  { key: 'walk', label: 'zu Fuß', color: '#a16207' },
  { key: 'bus', label: 'Bus', color: '#1d4f91' },
  { key: 'subway', label: 'U-Bahn', color: '#e3000f' },
  { key: 'tram', label: 'Straßenbahn', color: '#d97706' },
  { key: 'rail', label: 'S-Bahn & Zug', color: '#0891b2' },
  { key: 'unknown', label: 'Öffis, Linie noch offen', color: '#a8a29e' },
] as const
type ModeKey = (typeof MODES)[number]['key']

function modeKey(motis: string): ModeKey {
  if (motis === 'WALK') return 'walk'
  if (motis === 'BUS' || motis === 'COACH') return 'bus'
  if (motis === 'SUBWAY') return 'subway'
  if (motis === 'TRAM') return 'tram'
  return 'rail'
}

interface Props {
  slots: SlotView[]
  routes: (TransitRoute | null | undefined)[]
  stopMinutes: number
}

export default function TourStats({ slots, routes, stopMinutes }: Props) {
  const filled = slots.flatMap((s) => (s.stop ? [s.stop] : []))
  const minutes = new Map<ModeKey, number>()
  const add = (k: ModeKey, m: number) => minutes.set(k, (minutes.get(k) ?? 0) + m)
  slots.forEach((sl, i) => {
    const l = sl.stop?.legIn
    if (!l || l.mode === 'unreachable' || sl.afterGap) return
    if (l.mode === 'walk') return add('walk', l.minutes)
    const r = routes[i]
    const total = r?.parts.reduce((a, p) => a + p.minutes, 0) ?? 0
    // Spread the matrix minutes (incl. waiting) over the route's parts by their share.
    if (r && total > 0) for (const p of r.parts) add(modeKey(p.mode), (l.minutes * p.minutes) / total)
    else add('unknown', l.minutes)
  })
  const travel = [...minutes.values()].reduce((a, b) => a + b, 0)
  const stay = filled.length * stopMinutes
  const types = VENUE_TYPES.map((t) => [t, filled.filter((s) => s.bar.venueType === t).length] as const).filter(([, n]) => n)
  const tagCount = (t: Tag) => filled.filter((s) => s.bar.tags.includes(t)).length
  const closed = filled.filter((s) => s.closedOnArrival).length
  const empty = slots.length - filled.length
  const first = filled[0]
  const last = filled[filled.length - 1]

  return (
    <section className="card stats" aria-label="Tour in Zahlen">
      <div className="card-head"><h3>Eure Tour in Zahlen</h3></div>
      <div className="stat-tiles">
        <div><strong>{filled.length}</strong><span>Lokale{empty ? ` (+${empty} offen)` : ''}</span></div>
        <div><strong>{first && last ? `${clock(first.arrival)}–${clock(last.departure)}` : '–'}</strong><span>von bis</span></div>
        <div><strong>{duration(travel)}</strong><span>unterwegs</span></div>
        <div><strong>{duration(stay)}</strong><span>im Lokal</span></div>
      </div>
      {travel > 0 && (
        <>
          <h4>Wege</h4>
          <div className="mode-bar" role="img" aria-label={MODES.filter((m) => minutes.get(m.key)).map((m) => `${m.label} ${Math.round(minutes.get(m.key)!)} Min.`).join(', ')}>
            {MODES.filter((m) => minutes.get(m.key)).map((m) => (
              <span key={m.key} className={m.key === 'unknown' ? 'hatched' : undefined}
                style={{ flexGrow: minutes.get(m.key), background: m.key === 'unknown' ? undefined : m.color }}
                title={`${m.label}: ${Math.round(minutes.get(m.key)!)} Min.`} />
            ))}
          </div>
          <ul className="mode-legend">
            {MODES.filter((m) => minutes.get(m.key)).map((m) => (
              <li key={m.key}>
                <i className={m.key === 'unknown' ? 'hatched' : undefined} style={{ background: m.key === 'unknown' ? undefined : m.color }} />
                {m.label} <strong>{Math.round(minutes.get(m.key)!)} Min.</strong>
              </li>
            ))}
          </ul>
        </>
      )}
      {types.length > 0 && (
        <>
          <h4>Lokaltypen</h4>
          <ul className="type-counts">
            {types.map(([t, n]) => (
              <li key={t}><span className="dot" style={{ background: TYPE_COLOR[t] }} /> <TypeIcon type={t} /> {TYPE_SHORT[t]} <strong>{n}</strong></li>
            ))}
          </ul>
        </>
      )}
      {filled.length > 0 && (
        <>
          <h4>Merkmale</h4>
          <div className="chips">
            {TAGS.filter((t) => tagCount(t)).map((t) => <span key={t} className="chip">{TAG_LABEL[t]} · {tagCount(t)}</span>)}
            {TAGS.every((t) => !tagCount(t)) && <span className="chip muted">noch keine getaggten Lokale</span>}
          </div>
        </>
      )}
      {closed > 0 && <p className="warn small"><Icon name="warn" size={14} /> {closed} Lokal{closed > 1 ? 'e' : ''} bei Ankunft geschlossen</p>}
    </section>
  )
}
