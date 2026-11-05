import { clock, isOpenAt } from '../domain/hours'
import { tipLabel } from '../domain/filter'
import { googleMapsPlace } from '../domain/travel'
import { VENUE_TYPE_LABEL, type Bar } from '../domain/types'
import { TYPE_COLOR } from '../theme'
import Icon, { ModeIcon, TypeIcon } from './Icon'
import { OpenStatus, TagChips } from './BarFacts'
import TagEditor from './TagEditor'

interface Props {
  bar: Bar
  /** Planned arrival (minute of week) if the bar were added now. */
  arrival: number | null
  blockedBy: Bar | null
  inTour: boolean
  newestEdition: string | null
  /** The tour has no stops yet: offer tours starting here. */
  tourEmpty: boolean
  busy: boolean
  onAdd: () => void
  /** Put this bar in place of `blockedBy`. */
  onReplace: () => void
  /** Propose complete tours starting at this bar. */
  onPropose: () => void
  /** The tour has an empty slot for this bar's district. */
  emptySlot: boolean
  /** In "Meine Lokale"; the heart toggles it, in both modes. */
  mine: boolean
  onMine: () => void
  /** Finder mode: no tour actions. */
  finder?: {
    /** The way from the finder's point (location or marker) to this bar. */
    route?: { mode: 'walk' | 'transit'; text: string; lines: string[]; href: string }
  }
  onClose: () => void
  onTagChange?: (bar: Bar, tag: string, value: 0 | 1) => void
}

function editionLabel(e: string): string {
  const [y, m] = e.split('-')
  return `${m === '04' ? 'April' : m === '10' ? 'Oktober' : m} ${y}`
}

export default function BarPanel(props: Props) {
  const { bar, arrival, blockedBy, inTour, newestEdition, tourEmpty, busy, onAdd, onReplace, onPropose, emptySlot, mine, onMine, finder, onClose, onTagChange } = props
  const open = arrival === null ? null : isOpenAt(bar.weeklyOpen, arrival)
  return (
    <section className="card bar-card" aria-label="Ausgewähltes Lokal">
      <div className="bar-hero" style={{ '--c': TYPE_COLOR[bar.venueType] } as React.CSSProperties}>
        <span className="hero-icon" aria-hidden="true"><TypeIcon type={bar.venueType} size={22} /></span>
        <div className="hero-text">
          <h2 className="bar-name">{bar.name}</h2>
          <p>{bar.district}. Bezirk · {VENUE_TYPE_LABEL[bar.venueType]}</p>
        </div>
        <button type="button" className="icon-btn hero-close" aria-label="Schließen" onClick={onClose}><Icon name="x" size={18} /></button>
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
        {finder?.route && (
          <p className="finder-route">
            <span><ModeIcon mode={finder.route.mode} size={15} /> {finder.route.text}{finder.route.lines.length ? ` · ${finder.route.lines.join(' → ')}` : ''}</span>
            <a href={finder.route.href} target="_blank" rel="noreferrer">Route <Icon name="arrow-up-right" size={13} /></a>
          </p>
        )}
        <div className="chips"><TagChips bar={bar} /></div>
        {bar.tips && bar.tips.length > 0 && (
          <p className="tips">
            <Icon name="star" size={13} filled /> Empfohlen von{' '}
            {bar.tips.map((t, i) => (
              <span key={`${t.url}${t.kind ?? ''}`}>{i > 0 && ', '}<a href={t.url} target="_blank" rel="noreferrer">{tipLabel(t)}</a></span>
            ))}
          </p>
        )}
        <dl className="facts">
          {bar.address && <><dt>Adresse</dt><dd>{bar.address}</dd></>}
          <dt>Öffnungszeiten</dt><dd>{bar.openingHoursText ?? 'unbekannt'}</dd>
          {arrival !== null && <><dt>Ankunft</dt><dd>{clock(arrival)}{open === false && <strong className="warn"> · geschlossen</strong>}</dd></>}
        </dl>
        <div className="actions">
          {!finder && (<>
          {inTour ? (
            <span className="in-tour"><Icon name="check" size={15} /> In eurer Tour</span>
          ) : (
            blockedBy ? (
              <button type="button" className="primary" onClick={onReplace}>Statt {blockedBy.name} nehmen</button>
            ) : (
              <button type="button" className="primary" onClick={onAdd}>{emptySlot ? 'In den offenen Platz setzen' : 'Zur Tour hinzufügen'}</button>
            )
          )}
          {tourEmpty && !inTour && (
            <button type="button" className="ghost" disabled={busy} onClick={onPropose} title="Drei komplette Touren, die hier beginnen">
              <Icon name="sparkles" size={14} /> Touren ab hier
            </button>
          )}
          </>)}
          <button type="button" className={`ghost mine-btn${mine ? ' on' : ''}`} aria-pressed={mine} onClick={onMine}
            title={mine ? 'Aus „Meine Lokale“ entfernen' : 'Zu „Meine Lokale“ hinzufügen'}>
            <Icon name="heart" size={14} filled={mine} /> {mine ? 'Gemerkt' : 'Merken'}
          </button>
          {bar.website && <a className="ghost" href={bar.website} target="_blank" rel="noreferrer">Website</a>}
          <a className="ghost" href={googleMapsPlace(bar)} target="_blank" rel="noreferrer">In Google Maps ansehen</a>
        </div>
        {import.meta.env.DEV && onTagChange && <TagEditor bar={bar} onChange={onTagChange} />}
      </div>
    </section>
  )
}
