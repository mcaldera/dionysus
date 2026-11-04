import { useMemo, useState } from 'react'
import { clock, WEEKDAYS } from '../domain/hours'
import { TAG_LABEL, TAGS, VENUE_TYPES, type Bar, type Participant, type Tag, type VenueType } from '../domain/types'
import { TYPE_COLOR, TYPE_ICON, TYPE_SHORT } from '../theme'

export interface Settings {
  weekday: number
  startMinutes: number
  stopMinutes: number
  walkToleranceMinutes: number
  venueTypes: Set<VenueType>
  officialOnly: boolean
}

interface Props {
  bars: Bar[]
  settings: Settings
  onSettings: (s: Settings) => void
  group: Participant
  onGroup: (p: Participant) => void
  onPick: (id: string) => void
  onTaste: () => void
}

function norm(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss')
}

export default function FilterBar({ bars, settings, onSettings, group, onGroup, onPick, onTaste }: Props) {
  const [query, setQuery] = useState('')
  const counts = useMemo(() => {
    const c = new Map<VenueType, number>()
    for (const b of bars) c.set(b.venueType, (c.get(b.venueType) ?? 0) + 1)
    return c
  }, [bars])
  const hits = useMemo(() => {
    const q = norm(query.trim())
    if (q.length < 2) return []
    return bars.filter((b) => norm(b.name).includes(q)).slice(0, 8)
  }, [bars, query])

  function toggleType(t: VenueType) {
    const next = new Set(settings.venueTypes)
    if (next.has(t)) next.delete(t)
    else next.add(t)
    onSettings({ ...settings, venueTypes: next })
  }

  function cycle(tag: Tag) {
    // egal → mag → lieber nicht → egal
    const likes = group.likes.filter((t) => t !== tag)
    const avoids = group.avoids.filter((t) => t !== tag)
    if (group.likes.includes(tag)) avoids.push(tag)
    else if (!group.avoids.includes(tag)) likes.push(tag)
    onGroup({ ...group, likes, avoids })
  }

  const prefCount = group.likes.length + group.avoids.length + (group.likedTypes?.length ?? 0) + (group.avoidedTypes?.length ?? 0)

  return (
    <div className="topbar-inner">
      <div className="brand">
        <span className="logo" aria-hidden="true">🍺</span>
        <h1>Seidl-Tour-Planer</h1>
      </div>
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
      <div className="type-chips" role="group" aria-label="Lokaltypen">
        {VENUE_TYPES.map((t) => (
          <button key={t} type="button" className="type-chip" aria-pressed={settings.venueTypes.has(t)}
            style={{ '--c': TYPE_COLOR[t] } as React.CSSProperties} onClick={() => toggleType(t)}
            title={`${TYPE_SHORT[t]} ein- oder ausblenden`}>
            <span className="dot" /> {TYPE_SHORT[t]} <span className="count">{counts.get(t) ?? 0}</span>
          </button>
        ))}
        <button type="button" className="type-chip official" aria-pressed={settings.officialOnly}
          onClick={() => onSettings({ ...settings, officialOnly: !settings.officialOnly })}>
          ★ Offiziell
        </button>
      </div>
      <div className="top-actions">
        <details className="popover">
          <summary>🕒 {WEEKDAYS[settings.weekday].slice(0, 2)} {clock(settings.startMinutes)}</summary>
          <div className="popover-body">
            <label>Wochentag
              <select value={settings.weekday} onChange={(e) => onSettings({ ...settings, weekday: Number(e.target.value) })}>
                {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
              </select>
            </label>
            <label>Startzeit
              <input type="time" value={clock(settings.startMinutes)} step={900}
                onChange={(e) => {
                  const [h, m] = e.target.value.split(':').map(Number)
                  if (!Number.isNaN(h)) onSettings({ ...settings, startMinutes: h * 60 + (m || 0) })
                }} />
            </label>
            <label>Aufenthalt pro Lokal
              <select value={settings.stopMinutes} onChange={(e) => onSettings({ ...settings, stopMinutes: Number(e.target.value) })}>
                {[10, 15, 20, 30, 45, 60].map((m) => <option key={m} value={m}>{m} Min.</option>)}
              </select>
            </label>
          </div>
        </details>
        <details className="popover">
          <summary>♥ Vorlieben{prefCount ? ` (${prefCount})` : ''}</summary>
          <div className="popover-body wide">
            <p className="hint">Klicken: mag → lieber nicht → egal</p>
            <div className="chips">
              {TAGS.map((t) => {
                const state = group.likes.includes(t) ? 'like' : group.avoids.includes(t) ? 'avoid' : 'none'
                return (
                  <button key={t} type="button" className={`chip pref-${state}`} onClick={() => cycle(t)}>
                    {state === 'like' ? '♥ ' : state === 'avoid' ? '✕ ' : ''}{TAG_LABEL[t]}
                  </button>
                )
              })}
            </div>
            {(group.likedTypes?.length || group.avoidedTypes?.length) ? (
              <p className="hint">
                Aus dem Geschmackstest: {group.likedTypes?.map((t) => `♥ ${TYPE_SHORT[t]}`).join(', ')}
                {group.avoidedTypes?.length ? ` · ${group.avoidedTypes.map((t) => `✕ ${TYPE_SHORT[t]}`).join(', ')}` : ''}
              </p>
            ) : null}
            <button type="button" className="ghost small" onClick={() => onGroup({ name: group.name, likes: [], avoids: [] })}>Zurücksetzen</button>
          </div>
        </details>
        <button type="button" className="accent-btn" onClick={onTaste}>✨ Geschmackstest</button>
      </div>
    </div>
  )
}
