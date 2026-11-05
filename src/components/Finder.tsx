// Beisl-Finder: the map buttons (point, location) and the nearby list.

import { clock, openUntil } from '../domain/hours'
import type { NearbyResult } from '../domain/nearby'
import { TYPE_COLOR } from '../theme'
import { TagChips, TipBadge, TypePill } from './BarFacts'
import Icon, { ModeIcon, TypeIcon } from './Icon'

const BUDGETS = [5, 10, 15, 20, 30]
/** Bars listed; the map shows all in reach, in their type colours. */
const LISTED = 10

interface ButtonsProps {
  locating: boolean
  /** The origin is the visitor's position. */
  located: boolean
  placing: boolean
  onLocate: () => void
  onPlace: () => void
  style: React.CSSProperties
}

/** Round buttons on the map, as in map apps: set a point, use my location. */
export function MapButtons(p: ButtonsProps) {
  return (
    <div className="map-fabs" style={p.style}>
      <button type="button" className={`fab${p.placing ? ' on' : ''}`} aria-pressed={p.placing} onClick={p.onPlace}
        aria-label="Punkt auf der Karte setzen" title="Punkt auf der Karte setzen">
        <Icon name="pin" size={20} />
      </button>
      <button type="button" className={`fab${p.located ? ' on' : ''}`} disabled={p.locating} onClick={p.onLocate}
        aria-label="Meinen Standort verwenden" title="Meinen Standort verwenden">
        {p.locating ? <span className="spinner" /> : <Icon name="locate" size={20} />}
      </button>
    </div>
  )
}

/** A short note at the top of the map: what to do while placing, or why locating failed. */
export function MapToast({ children, warn, onClose }: { children: React.ReactNode; warn?: boolean; onClose: () => void }) {
  return (
    <div className={`map-toast${warn ? ' warn' : ''}`} role="status">
      <span>{children}</span>
      <button type="button" className="icon-btn" aria-label="Schließen" onClick={onClose}><Icon name="x" size={15} /></button>
    </div>
  )
}

interface NearbyProps {
  title: string
  results: NearbyResult[]
  maxMinutes: number
  transit: boolean
  /** Minute of the week you leave, for "open until" at arrival. */
  departure: number | null
  highlightId: string | null
  onMaxMinutes: (m: number) => void
  onTransit: (t: boolean) => void
  onPick: (id: string) => void
  onHover: (id: string | null) => void
  onSurprise: () => void
  onClear?: () => void
}

export function NearbyList(p: NearbyProps) {
  const shown = p.results.slice(0, LISTED)
  return (
    <section className="card" aria-label="In der Nähe">
      <div className="card-head">
        <h3>{p.title}</h3>
        {p.onClear && <button type="button" className="icon-btn" aria-label="Punkt entfernen" onClick={p.onClear}><Icon name="x" size={18} /></button>}
      </div>
      <div className="finder-controls">
        <div className="segmented" role="group" aria-label="Höchstens Minuten">
          {BUDGETS.map((b) => (
            <button key={b} type="button" aria-pressed={p.maxMinutes === b} onClick={() => p.onMaxMinutes(b)}>{b}′</button>
          ))}
        </div>
        <div className="segmented" role="group" aria-label="Wie hinkommen">
          <button type="button" aria-pressed={!p.transit} onClick={() => p.onTransit(false)}><Icon name="walk" size={14} /> zu Fuß</button>
          <button type="button" aria-pressed={p.transit} onClick={() => p.onTransit(true)}><Icon name="tram" size={14} /> + Öffis</button>
        </div>
      </div>
      <div className="finder-summary">
        <span className="hint small">{p.results.length} Lokale in {p.maxMinutes} Min.</span>
        {p.results.length > 1 && <button type="button" className="ghost small" onClick={p.onSurprise}><Icon name="shuffle" size={14} /> Überrasch mich</button>}
      </div>
      {p.results.length === 0 ? (
        <p className="hint">Nichts in dieser Zeit. Mehr Minuten oder Öffis versuchen?</p>
      ) : (
        <ol className="recs">
          {shown.map((r) => {
            const until = p.departure !== null && r.open ? openUntil(r.bar.weeklyOpen, p.departure + r.minutes) : null
            return (
              <li key={r.bar.id}>
                <button type="button" className={`rec${p.highlightId === r.bar.id ? ' active' : ''}`} onClick={() => p.onPick(r.bar.id)}
                  onMouseEnter={() => p.onHover(r.bar.id)} onMouseLeave={() => p.onHover(null)}>
                  {/* The type colour, as on the map: no numbers to match up. */}
                  <span className="rec-type" style={{ '--c': TYPE_COLOR[r.bar.venueType] } as React.CSSProperties} aria-hidden="true">
                    <TypeIcon type={r.bar.venueType} size={14} />
                  </span>
                  <span className="rec-main">
                    <span className="rec-title"><span className="rec-name">{r.bar.name}</span> <TipBadge bar={r.bar} /></span>
                    <span className="rec-meta">
                      <TypePill bar={r.bar} /> <span>{r.bar.district}. Bezirk</span>
                      {p.departure !== null && (r.open === null
                        ? <span className="status unknown">Zeiten unbekannt</span>
                        : <span className="status open">offen{until !== null ? ` bis ${clock(until)}` : ''}</span>)}
                    </span>
                    <span className="chips"><TagChips bar={r.bar} max={4} /></span>
                  </span>
                  <span className={`leg-pill ${r.mode}`}><ModeIcon mode={r.mode} size={13} /> {r.minutes}<small>min</small></span>
                </button>
              </li>
            )
          })}
        </ol>
      )}
      {p.results.length > shown.length && <p className="hint small">+{p.results.length - shown.length} weitere auf der Karte</p>}
    </section>
  )
}
