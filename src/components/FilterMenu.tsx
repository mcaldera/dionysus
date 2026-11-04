// Header: brand, map filter (what you see), search, and the button that opens tour planning.

import { useEffect, useMemo, useRef, useState } from 'react'
import { activeFilters, barSources, matchesFilter, SOURCE_KINDS, SOURCE_LABEL, type MapFilter, type SourceKind } from '../domain/filter'
import { clock, DAY, WEEKDAYS } from '../domain/hours'
import { TAG_LABEL, TAGS, VENUE_TYPES, type Bar, type Tag, type VenueType } from '../domain/types'
import { TYPE_COLOR, TYPE_ICON, TYPE_SHORT } from '../theme'

interface Props {
  bars: Bar[]
  filter: MapFilter
  onFilter: (f: MapFilter) => void
  /** Default day and time for "open at", from the tour plan. */
  planMinuteOfWeek: number
  onPick: (id: string) => void
  onPlan: () => void
  planSummary: string
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

export default function FilterMenu({ bars, filter, onFilter, planMinuteOfWeek, onPick, onPlan, planSummary }: Props) {
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

  const counts = useMemo(() => {
    const types = new Map<VenueType, number>()
    const tags = new Map<Tag, number>()
    const sources = new Map<SourceKind, number>()
    for (const b of bars) {
      types.set(b.venueType, (types.get(b.venueType) ?? 0) + 1)
      for (const t of b.tags) tags.set(t, (tags.get(t) ?? 0) + 1)
      for (const s of barSources(b)) sources.set(s, (sources.get(s) ?? 0) + 1)
    }
    return { types, tags, sources }
  }, [bars])
  const visible = useMemo(() => bars.filter((b) => matchesFilter(b, filter)).length, [bars, filter])
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
        <span className="logo" aria-hidden="true">🍺</span>
        <h1>Seidl-Tour-Planer</h1>
      </div>
      <details className="popover filter-menu">
        <summary>⚲ Filter{active ? <span className="badge-count">{active}</span> : null} <span className="caret">▾</span></summary>
        <div className="popover-body filter-body">
          <p className="hint small">Filtert, was ihr auf der Karte und in den Vorschlägen seht. Die Tourplanung nutzt ihre eigenen Einstellungen. · {visible} von {bars.length} Lokalen</p>
          <section>
            <h4>Lokaltypen</h4>
            <div className="chips">
              {VENUE_TYPES.map((t) => (
                <button key={t} type="button" className="type-toggle" aria-pressed={filter.venueTypes.has(t)}
                  style={{ '--c': TYPE_COLOR[t] } as React.CSSProperties}
                  onClick={() => onFilter({ ...filter, venueTypes: toggled(filter.venueTypes, t) })}>
                  <span className="dot" /> {TYPE_ICON[t]} {TYPE_SHORT[t]} <span className="count">{counts.types.get(t) ?? 0}</span>
                </button>
              ))}
            </div>
          </section>
          <section>
            <h4>Muss haben</h4>
            <div className="chips">
              {TAGS.map((t) => (
                <button key={t} type="button" className="chip toggle" aria-pressed={filter.tags.has(t)}
                  disabled={!counts.tags.get(t) && !filter.tags.has(t)}
                  onClick={() => onFilter({ ...filter, tags: toggled(filter.tags, t) })}>
                  {TAG_LABEL[t]} <span className="count">{counts.tags.get(t) ?? 0}</span>
                </button>
              ))}
            </div>
            <p className="hint small">Viele Lokale sind noch nicht getaggt; „Essen“ und „Gastgarten“ sind am vollständigsten.</p>
          </section>
          <section>
            <h4>Empfohlen von</h4>
            <div className="chips">
              {SOURCE_KINDS.map((k) => (
                <button key={k} type="button" className="chip toggle" aria-pressed={filter.sources.has(k)}
                  disabled={!counts.sources.get(k) && !filter.sources.has(k)}
                  onClick={() => onFilter({ ...filter, sources: toggled(filter.sources, k) })}>
                  {k === 'offiziell' ? '★ ' : '☆ '}{SOURCE_LABEL[k]} <span className="count">{counts.sources.get(k) ?? 0}</span>
                </button>
              ))}
            </div>
          </section>
          <section>
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
              <input type="time" aria-label="Uhrzeit" step={900} value={clock(openAt)} disabled={filter.openAt === null}
                onChange={(e) => {
                  const [h, m] = e.target.value.split(':').map(Number)
                  if (!Number.isNaN(h)) onFilter({ ...filter, openAt: openDay * DAY + h * 60 + (m || 0) })
                }} />
            </div>
          </section>
          <button type="button" className="ghost small" disabled={!active}
            onClick={() => onFilter({ venueTypes: new Set(VENUE_TYPES), tags: new Set(), sources: new Set(), openAt: null })}>
            Filter zurücksetzen
          </button>
        </div>
      </details>
      <div className="search">
        <span className="search-icon" aria-hidden="true">⌕</span>
        <input type="search" placeholder="Lokal suchen" aria-label="Lokal suchen" value={query}
          onChange={(e) => setQuery(e.target.value)} />
        {hits.length > 0 && (
          <ul className="search-hits">
            {hits.map((b) => (
              <li key={b.id}>
                <button type="button" onClick={() => { onPick(b.id); setQuery('') }}>
                  <span aria-hidden="true">{TYPE_ICON[b.venueType]}</span> {b.name} <span className="muted">{b.district}.</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="top-actions">
        <span className="plan-summary">{planSummary}</span>
        <button type="button" className="accent-btn" onClick={onPlan}>🗺 Tour planen</button>
      </div>
    </div>
  )
}
