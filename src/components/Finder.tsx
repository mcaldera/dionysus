// Beisl-Finder panels: the start card (where are you?) and the nearby list.

import { clock, openUntil } from '../domain/hours'
import type { NearbyResult } from '../domain/nearby'
import type { Bar } from '../domain/types'
import { TagChips, TipBadge, TypePill } from './BarFacts'
import Icon, { ModeIcon } from './Icon'

const BUDGETS = [5, 10, 15, 20, 30]
/** Bars listed (and numbered on the map). */
const LISTED = 15

interface StartProps {
  locating: boolean
  locateError: string | null
  placing: boolean
  favorites: Bar[]
  onLocate: () => void
  onPlace: () => void
  onPick: (id: string) => void
}

export function FinderStart(p: StartProps) {
  return (
    <section className="card welcome" aria-label="Beisl-Finder">
      <h2>Wo seid ihr?</h2>
      <p>Wir zeigen, was in eurer Nähe gerade offen hat.</p>
      <div className="plan-modes">
        <button type="button" className="plan-mode" disabled={p.locating} onClick={p.onLocate}>
          <strong><Icon name="navigation" /> Meinen Standort verwenden</strong>
          <span>{p.locating ? 'Suche den Standort …' : 'Euer Browser fragt um Erlaubnis; der Standort bleibt auf eurem Gerät.'}</span>
        </button>
        <button type="button" className={`plan-mode${p.placing ? ' active' : ''}`} onClick={p.onPlace}>
          <strong><Icon name="crosshair" /> Punkt auf der Karte setzen</strong>
          <span>{p.placing ? 'Jetzt auf die Karte klicken …' : 'Zum Beispiel euer Zuhause. Auch mit Rechtsklick auf die Karte.'}</span>
        </button>
        <div className="plan-mode static">
          <strong><Icon name="beer" /> Von einem Lokal aus</strong>
          <span>Klickt ein Lokal an: Wir zeigen, was von dort in ein paar Minuten erreichbar ist, egal in welchem Bezirk.</span>
        </div>
      </div>
      {p.locateError && <p className="warn small">{p.locateError}</p>}
      {p.favorites.length > 0 && (
        <>
          <h4 className="sub">Eure Merkliste</h4>
          <ul className="fav-list">
            {p.favorites.map((b) => (
              <li key={b.id}>
                <button type="button" className="link" onClick={() => p.onPick(b.id)}>{b.name}</button>
                <span className="muted small"> {b.district}. Bezirk</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
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
        <span className="hint small">{p.results.length} Lokale in {p.maxMinutes} Min.{p.departure !== null ? ', nicht sicher geschlossen' : ''}</span>
        {p.results.length > 1 && <button type="button" className="ghost small" onClick={p.onSurprise}><Icon name="shuffle" size={14} /> Überrasch mich</button>}
      </div>
      {p.results.length === 0 ? (
        <p className="hint">Nichts in dieser Zeit. Mehr Minuten oder Öffis versuchen?</p>
      ) : (
        <ol className="recs">
          {shown.map((r, i) => {
            const until = p.departure !== null && r.open ? openUntil(r.bar.weeklyOpen, p.departure + r.minutes) : null
            return (
              <li key={r.bar.id}>
                <button type="button" className={`rec${p.highlightId === r.bar.id ? ' active' : ''}`} onClick={() => p.onPick(r.bar.id)}
                  onMouseEnter={() => p.onHover(r.bar.id)} onMouseLeave={() => p.onHover(null)}>
                  <span className="rank">{i + 1}</span>
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
