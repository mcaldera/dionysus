// Header: brand, map filter (what you see), search, and the button that opens tour planning.

import { useEffect, useMemo, useRef, useState } from 'react'
import { activeFilters, barSources, includeWeak, SOURCE_KINDS, SOURCE_LABEL, TIP_KIND_LABEL, TIP_KINDS, tipKinds, type MapFilter, type SourceKind, type TipKind } from '../domain/filter'
import { clock, DAY, WEEKDAYS } from '../domain/hours'
import { CHARACTER_TAGS, SCORE_TAGS, TAG_LABEL, VENUE_TYPES, type Bar, type Tag, type VenueType } from '../domain/types'
import { TYPE_COLOR, TYPE_SHORT } from '../theme'
import Icon, { TypeIcon } from './Icon'

interface Props {
  bars: Bar[]
  filter: MapFilter
  onFilter: (f: MapFilter) => void
  /** Default day and time for "open at", from the tour plan. */
  planMinuteOfWeek: number
  onPick: (id: string) => void
  mode: AppMode
  /** The open-at filter; the finder has its own time control instead. */
  showOpenFilter: boolean
  onMode: (m: AppMode) => void
  /** Mode-specific controls on the right. */
  actions: React.ReactNode
}

export type AppMode = 'finder' | 'tour' | 'atlas'

/** What the score tags mean, as tooltips (thresholds: 07_build_site_data.py SCORE_TAGS). */
export const SCORE_HINT: Partial<Record<Tag, string>> = {
  beliebt: 'Beliebtheit ab 70: bekannter als 70 % der Lokale',
  top_bewertet: 'Zufriedenheit ab 85: die Gäste sind begeistert',
  geheimtipp: 'Sehr gut bewertet, aber wenig bekannt',
  polarisiert: 'Viele lieben es, einige gar nicht',
}

function norm(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss')
}

function toggled<T>(set: Set<T>, x: T): Set<T> {
  const next = new Set(set)
  if (next.has(x)) next.delete(x)
  else next.add(x)
  return next
}

export default function FilterMenu({ bars, filter, onFilter, planMinuteOfWeek, onPick, mode, onMode, showOpenFilter, actions }: Props) {
  const [query, setQuery] = useState('')
  const root = useRef<HTMLDivElement>(null)

  // Popovers close on any click outside them, including the map, and on Escape.
  useEffect(() => {
    const close = (keep: EventTarget | null) => {
      root.current?.querySelectorAll('details.popover[open]').forEach((d) => {
        if (!(keep instanceof Node) || !d.contains(keep)) d.removeAttribute('open')
      })
    }
    const onDown = (e: PointerEvent) => close(e.target)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(null) }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  const weak = includeWeak(filter)
  const counts = useMemo(() => {
    const types = new Map<VenueType, number>()
    const tags = new Map<Tag, number>()
    const sources = new Map<SourceKind, number>()
    const kinds = new Map<TipKind, number>()
    for (const b of bars) {
      types.set(b.venueType, (types.get(b.venueType) ?? 0) + 1)
      for (const t of b.tags) tags.set(t, (tags.get(t) ?? 0) + 1)
      for (const s of barSources(b, weak)) sources.set(s, (sources.get(s) ?? 0) + 1)
      for (const k of tipKinds(b, weak)) kinds.set(k, (kinds.get(k) ?? 0) + 1)
    }
    return { types, tags, sources, kinds }
  }, [bars, weak])
  const hits = useMemo(() => {
    const q = norm(query.trim())
    if (q.length < 2) return []
    return bars.filter((b) => norm(b.name).includes(q)).slice(0, 8)
  }, [bars, query])
  const active = activeFilters(filter, VENUE_TYPES.length)
  const openAt = filter.openAt ?? planMinuteOfWeek
  const openDay = Math.floor(openAt / DAY) % 7

  return (
    <div className="topbar-inner" ref={root}>
      <div className="brand">
        <span className="logo" aria-hidden="true"><Icon name="beer" size={17} /></span>
        <h1>Wiener Durst</h1>
      </div>
      <div className="mode-tabs" role="tablist" aria-label="Modus">
        <button type="button" role="tab" aria-selected={mode === 'finder'} onClick={() => onMode('finder')}>Beisl-Finder</button>
        <button type="button" role="tab" aria-selected={mode === 'tour'} onClick={() => onMode('tour')}>Seidl-Tour</button>
        <button type="button" role="tab" aria-selected={mode === 'atlas'} onClick={() => onMode('atlas')}>Atlas</button>
      </div>
      <details className="popover filter-menu">
        <summary><Icon name="sliders" size={15} /> Filter{active ? <span className="badge-count">{active}</span> : null} <Icon name="chevron-down" size={14} className="caret" /></summary>
        <div className="popover-body filter-body">
          <section>
            <h4>Lokaltypen</h4>
            <div className="chips">
              {VENUE_TYPES.map((t) => (
                <button key={t} type="button" className="type-toggle" aria-pressed={filter.venueTypes.has(t)}
                  style={{ '--c': TYPE_COLOR[t] } as React.CSSProperties}
                  onClick={() => onFilter({ ...filter, venueTypes: toggled(filter.venueTypes, t) })}>
                  <span className="dot" /> <TypeIcon type={t} /> {TYPE_SHORT[t]} <span className="count">{counts.types.get(t) ?? 0}</span>
                </button>
              ))}
            </div>
          </section>
          <section>
            <h4>Muss haben</h4>
            <div className="chips">
              {CHARACTER_TAGS.map((t) => (
                <button key={t} type="button" className="chip toggle" aria-pressed={filter.tags.has(t)}
                  disabled={!counts.tags.get(t) && !filter.tags.has(t)}
                  onClick={() => onFilter({ ...filter, tags: toggled(filter.tags, t) })}>
                  {TAG_LABEL[t]} <span className="count">{counts.tags.get(t) ?? 0}</span>
                </button>
              ))}
            </div>
          </section>
          <section>
            <h4>Beliebtheit & Bewertung</h4>
            <div className="chips">
              {SCORE_TAGS.map((t) => (
                <button key={t} type="button" className="chip toggle" aria-pressed={filter.tags.has(t)} title={SCORE_HINT[t]}
                  disabled={!counts.tags.get(t) && !filter.tags.has(t)}
                  onClick={() => onFilter({ ...filter, tags: toggled(filter.tags, t) })}>
                  {TAG_LABEL[t]} <span className="count">{counts.tags.get(t) ?? 0}</span>
                </button>
              ))}
            </div>
          </section>
          <section>
            <h4>Empfohlen als</h4>
            <div className="chips">
              {TIP_KINDS.map((k) => (
                <button key={k} type="button" className="chip toggle" aria-pressed={filter.tipKinds.has(k)}
                  disabled={!counts.kinds.get(k) && !filter.tipKinds.has(k)}
                  onClick={() => onFilter({ ...filter, tipKinds: toggled(filter.tipKinds, k) })}>
                  {TIP_KIND_LABEL[k]} <span className="count">{counts.kinds.get(k) ?? 0}</span>
                </button>
              ))}
            </div>
          </section>
          <section>
            <h4>Empfohlen von</h4>
            <div className="chips">
              {SOURCE_KINDS.map((k) => (
                <button key={k} type="button" className="chip toggle" aria-pressed={filter.sources.has(k)}
                  disabled={!counts.sources.get(k) && !filter.sources.has(k)}
                  onClick={() => onFilter({ ...filter, sources: toggled(filter.sources, k) })}>
                  {SOURCE_LABEL[k]} <span className="count">{counts.sources.get(k) ?? 0}</span>
                </button>
              ))}
            </div>
            {filter.sources.has('forum') && (
              <label className="check">
                <input type="checkbox" checked={filter.weakTips} onChange={(e) => onFilter({ ...filter, weakTips: e.target.checked })} />
                Auch Lokale, die nur einmal in einem Thread erwähnt wurden
              </label>
            )}
          </section>
          {showOpenFilter && <section>
            <h4>Öffnungszeiten</h4>
            <label className="check">
              <input type="checkbox" checked={filter.openAt !== null}
                onChange={(e) => onFilter({ ...filter, openAt: e.target.checked ? planMinuteOfWeek : null })} />
              Nur Lokale, die nicht sicher geschlossen haben, am
            </label>
            <div className="inline-fields">
              <select aria-label="Wochentag" value={openDay} disabled={filter.openAt === null}
                onChange={(e) => onFilter({ ...filter, openAt: Number(e.target.value) * DAY + (openAt % DAY) })}>
                {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
              </select>
              <span>um</span>
              <input type="time" aria-label="Uhrzeit" step={900} min="00:00" value={clock(openAt)} disabled={filter.openAt === null}
                onChange={(e) => {
                  const [h, m] = e.target.value.split(':').map(Number)
                  if (!Number.isNaN(h)) onFilter({ ...filter, openAt: openDay * DAY + h * 60 + (m || 0) })
                }} />
            </div>
            <label className="check">
              <input type="checkbox" checked={filter.includeUnknownHours} disabled={filter.openAt === null}
                onChange={(e) => onFilter({ ...filter, includeUnknownHours: e.target.checked })} />
              Auch Lokale ohne bekannte Öffnungszeiten
            </label>
          </section>}
          <button type="button" className="ghost small" disabled={!active}
            onClick={() => onFilter({ venueTypes: new Set(VENUE_TYPES), tags: new Set(), sources: new Set(), tipKinds: new Set(), weakTips: false, openAt: null, includeUnknownHours: true })}>
            Filter zurücksetzen
          </button>
        </div>
      </details>
      <div className="search">
        <span className="search-icon"><Icon name="search" size={15} /></span>
        <input type="search" placeholder="Lokal suchen" aria-label="Lokal suchen" value={query}
          onChange={(e) => setQuery(e.target.value)} />
        {hits.length > 0 && (
          <ul className="search-hits">
            {hits.map((b) => (
              <li key={b.id}>
                <button type="button" onClick={() => { onPick(b.id); setQuery('') }}>
                  <TypeIcon type={b.venueType} /> {b.name} <span className="muted">{b.district}.</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="top-actions">{actions}</div>
    </div>
  )
}
