import { clock, isOpenAt } from '../domain/hours'
import { tipLabel } from '../domain/filter'
import { googleMapsPlace } from '../domain/travel'
import { VENUE_TYPE_LABEL, type Bar } from '../domain/types'
import { TYPE_COLOR } from '../theme'
import Icon, { ModeIcon, TypeIcon } from './Icon'
import { OpenStatus, TagChips } from './BarFacts'
import TagEditor from './TagEditor'
import { SIMILAR_SHOWN } from './Atlas'

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
  /** The most similar bars by profile, best first. */
  similar?: Bar[]
  onPickSimilar?: (id: string) => void
  onHoverSimilar?: (id: string | null) => void
  onClose: () => void
  onTagChange?: (bar: Bar, tag: string, value: 0 | 1) => void
  /** Friends' ratings and comments for this bar. */
  social?: React.ReactNode
}

function editionLabel(e: string): string {
  const [y, m] = e.split('-')
  return `${m === '04' ? 'April' : m === '10' ? 'Oktober' : m} ${y}`
}

export default function BarPanel(props: Props) {
  const { bar, arrival, blockedBy, inTour, newestEdition, tourEmpty, busy, onAdd, onReplace, onPropose, emptySlot, mine, onMine, finder, similar, onPickSimilar, onHoverSimilar, onClose, onTagChange, social } = props
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
      {/* Keyed by bar, so the body rises in again for each new bar. */}
      <div className="card-body" key={bar.id}>
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
        {bar.description && (
          <p className="bar-description">{bar.description}</p>
        )}
        <div className="chips"><TagChips bar={bar} /></div>
        {bar.popularity != null && <Scores bar={bar} />}
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
        {social}
        {similar && similar.length > 0 && onPickSimilar && (
          <div className="similar">
            <h3 title="Nach dem ganzen Profil: Stil, Publikum, Getränke, Merkmale und Beschreibung. Der Atlas zeigt dieselben Unterschiede auf zwei Dimensionen verkürzt, deshalb liegt dort nicht jedes ähnliche Lokal auch nah.">
              Ähnliche Lokale <span className="similar-why">nach Profil</span>
            </h3>
            <ul>
              {similar.slice(0, SIMILAR_SHOWN).map((b, i) => (
                <li key={b.id}>
                  <button type="button" onClick={() => onPickSimilar(b.id)}
                    onMouseEnter={() => onHoverSimilar?.(b.id)} onMouseLeave={() => onHoverSimilar?.(null)}>
                    <span className="similar-rank">{i + 1}</span>
                    <i className="type-dot" style={{ background: TYPE_COLOR[b.venueType] }} />
                    <span className="similar-name">{b.name}</span>
                    <span className="muted">{b.district}.</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {import.meta.env.DEV && onTagChange && <TagEditor bar={bar} onChange={onTagChange} />}
      </div>
    </section>
  )
}

function popularityLabel(value: number): string {
  if (value >= 90) return 'Publikumsmagnet'
  if (value >= 70) return 'sehr bekannt'
  if (value >= 40) return 'bekannt'
  if (value >= 15) return 'eher unbekannt'
  return 'kaum bekannt'
}

/** 50 = 4.0 stars, 70 = 4.4, 85 = 4.7 (corrected for few reviews). */
function satisfactionLabel(value: number): string {
  if (value >= 85) return 'begeistert'
  if (value >= 70) return 'sehr zufrieden'
  if (value >= 50) return 'zufrieden'
  if (value >= 30) return 'gemischt'
  return 'eher unzufrieden'
}

function Meter({ label, value, text, title }: { label: string; value: number; text: string; title: string }) {
  return (
    <div className="meter" title={title}>
      <span className="meter-label">{label}</span>
      <span className="meter-track" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} aria-label={label}>
        <span className="meter-fill" style={{ width: `${value}%` }} />
      </span>
      <span className="meter-value">{value} · {text}</span>
    </div>
  )
}

/** 0-100 scores derived from Google reviews; Google's stars and counts are not shown. */
function Scores({ bar }: { bar: Bar }) {
  return (
    <div className="scores">
      <Meter label="Beliebtheit" value={bar.popularity!} text={popularityLabel(bar.popularity!)}
        title="Wie bekannt das Lokal ist, im Vergleich zu allen Lokalen der Karte (0–100)" />
      {bar.satisfaction != null && (
        <Meter label="Zufriedenheit" value={bar.satisfaction} text={satisfactionLabel(bar.satisfaction)}
          title="Wie zufrieden die Gäste sind (0–100)" />
      )}
      {(bar.tags.includes('geheimtipp') || bar.tags.includes('polarisiert')) && (
        <div className="badges">
          {bar.tags.includes('geheimtipp') && (
            <span className="badge score" title={`Sehr gut bewertet, aber wenig bekannt (Geheimtipp-Wert ${bar.geheimtipp}/100)`}>Geheimtipp</span>
          )}
          {bar.tags.includes('polarisiert') && (
            <span className="badge score" title={`Viele lieben es, einige gar nicht (${bar.polarizing}/100)`}>Polarisiert</span>
          )}
        </div>
      )}
    </div>
  )
}
