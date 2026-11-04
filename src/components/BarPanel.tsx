import { clock, isOpenAt } from '../domain/hours'
import { googleMapsPlace } from '../domain/travel'
import { VENUE_TYPE_LABEL, type Bar } from '../domain/types'
import { TYPE_COLOR, TYPE_ICON } from '../theme'
import { OpenStatus, TagChips } from './BarFacts'
import TagEditor from './TagEditor'

interface Props {
  bar: Bar | null
  /** Planned arrival (minute of week) if the bar were added now. */
  arrival: number | null
  blockedBy: Bar | null
  inTour: boolean
  newestEdition: string | null
  /** The tour has no stops yet: offer planning from scratch. */
  tourEmpty: boolean
  busy: boolean
  onAdd: () => void
  /** Put this bar in place of `blockedBy`. */
  onReplace: () => void
  /** Propose complete tours, from this bar or (without a bar) from anywhere. */
  onPropose: () => void
  onClose: () => void
  onTagChange?: (bar: Bar, tag: string, value: 0 | 1) => void
}

function editionLabel(e: string): string {
  const [y, m] = e.split('-')
  return `${m === '04' ? 'April' : m === '10' ? 'Oktober' : m} ${y}`
}

export default function BarPanel(props: Props) {
  const { bar, arrival, blockedBy, inTour, newestEdition, tourEmpty, busy, onAdd, onReplace, onPropose, onClose, onTagChange } = props
  if (!bar) {
    return (
      <section className="card welcome" aria-label="Ausgewähltes Lokal">
        <h2>Prost! 🍻</h2>
        {tourEmpty ? (
          <>
            <p>Wie möchtet ihr planen?</p>
            <div className="plan-modes">
              <button type="button" className="plan-mode" disabled={busy} onClick={onPropose}>
                <strong>✨ Komplette Tour vorschlagen</strong>
                <span>Ihr bekommt sofort drei ganze Routen und tauscht dann einzelne Lokale.</span>
              </button>
              <div className="plan-mode static">
                <strong>👣 Schritt für Schritt</strong>
                <span>Klickt ein Lokal auf der Karte an oder sucht oben nach einem Namen. Dann zeigen wir die besten nächsten Lokale.</span>
              </div>
            </div>
            <p className="hint">Bezirke, Startzeit und Aufenthalt stellt ihr oben bei 🕒 ein, euren Geschmack bei ✨ Geschmackstest.</p>
          </>
        ) : (
          <>
            <p>Klickt ein Lokal auf der Karte an oder sucht oben nach einem Namen. Die Farben zeigen die Art des Lokals, größere Punkte haben mehr Infos.</p>
            <p className="hint">In der Tour unten könnt ihr jedes Lokal tauschen (⇄) oder fixieren (📌).</p>
          </>
        )}
      </section>
    )
  }
  const open = arrival === null ? null : isOpenAt(bar.weeklyOpen, arrival)
  return (
    <section className="card bar-card" aria-label="Ausgewähltes Lokal">
      <div className="bar-hero" style={{ '--c': TYPE_COLOR[bar.venueType] } as React.CSSProperties}>
        <span className="hero-icon" aria-hidden="true">{TYPE_ICON[bar.venueType]}</span>
        <div className="hero-text">
          <h2 className="bar-name">{bar.name}</h2>
          <p>{bar.district}. Bezirk · {VENUE_TYPE_LABEL[bar.venueType]}</p>
        </div>
        <button type="button" className="icon-btn hero-close" aria-label="Schließen" onClick={onClose}>×</button>
      </div>
      <div className="card-body">
        <div className="badges">
          {arrival !== null && <OpenStatus bar={bar} at={arrival} />}
          {bar.official.length > 0 && (
            <span className="badge official" title="Seidlwandertage-Partnerlokal">
              Partnerlokal {editionLabel(bar.official[bar.official.length - 1])}
              {newestEdition && !bar.official.includes(newestEdition) ? ' (früher)' : ''}
            </span>
          )}
        </div>
        <div className="chips"><TagChips bar={bar} /></div>
        {bar.tips && bar.tips.length > 0 && (
          <p className="tips">
            ★ Empfohlen von{' '}
            {bar.tips.map((t, i) => (
              <span key={t.url}>{i > 0 && ', '}<a href={t.url} target="_blank" rel="noreferrer">{t.source}</a></span>
            ))}
          </p>
        )}
        <dl className="facts">
          {bar.address && <><dt>Adresse</dt><dd>{bar.address}</dd></>}
          <dt>Öffnungszeiten</dt><dd>{bar.openingHoursText ?? 'unbekannt'}</dd>
          {arrival !== null && <><dt>Ankunft</dt><dd>{clock(arrival)}{open === false && <strong className="warn"> · geschlossen</strong>}</dd></>}
        </dl>
        <div className="actions">
          {inTour ? (
            <span className="in-tour">✓ In eurer Tour</span>
          ) : (
            blockedBy ? (
              <button type="button" className="primary" onClick={onReplace}>Statt {blockedBy.name} nehmen</button>
            ) : (
              <button type="button" className="primary" onClick={onAdd}>Zur Tour hinzufügen</button>
            )
          )}
          {tourEmpty && !inTour && (
            <button type="button" className="ghost" disabled={busy} onClick={onPropose} title="Drei komplette Touren, die hier beginnen">
              ✨ Touren ab hier
            </button>
          )}
          {bar.website && <a className="ghost" href={bar.website} target="_blank" rel="noreferrer">Website</a>}
          <a className="ghost" href={googleMapsPlace(bar)} target="_blank" rel="noreferrer">In Google Maps ansehen</a>
        </div>
        {blockedBy && !inTour && <p className="hint">Im {bar.district}. Bezirk habt ihr schon {blockedBy.name}; dieses Lokal kommt an seine Stelle.</p>}
        {import.meta.env.DEV && onTagChange && <TagEditor bar={bar} onChange={onTagChange} />}
      </div>
    </section>
  )
}
