import { useEffect, useMemo, useState } from 'react'
import { OpenStatus, TagChips, TipBadge, TypePill } from './components/BarFacts'
import BarPanel from './components/BarPanel'
import FilterBar, { type Settings } from './components/FilterBar'
import Footer from './components/Footer'
import MapView, { type HoverInfo, type Leg, type MapBar } from './components/MapView'
import Recommendations from './components/Recommendations'
import TasteFinder from './components/TasteFinder'
import TourPanel from './components/TourPanel'
import { loadSiteData, loadTransitRange, type SiteData } from './data'
import { arc } from './domain/geo'
import { DAY } from './domain/hours'
import { passesFilters, recommend, type Constraints, type Preferences } from './domain/recommend'
import { applyTagRows, type TagRow } from './domain/tagRows'
import { timeline } from './domain/tour'
import { leg, legLabel, legMinutes } from './domain/travel'
import { VENUE_TYPES, type Bar, type Participant } from './domain/types'
import { walkingPath } from './routes'
import './styles.css'

const ALL_DISTRICTS = 23

function pathKey(a: Bar, b: Bar): string {
  return `${a.id}>${b.id}`
}

export default function App() {
  const [data, setData] = useState<SiteData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [settings, setSettings] = useState<Settings>({
    weekday: 5, startMinutes: 11 * 60, stopMinutes: 20, walkToleranceMinutes: 5,
    venueTypes: new Set(VENUE_TYPES), officialOnly: false,
  })
  const [group, setGroup] = useState<Participant>({ name: 'Wir', likes: [], avoids: [] })
  const [prefs, setPrefs] = useState<Omit<Preferences, 'participants'>>({ similarity: 'similar', speedVsMatch: 0.5 })
  const [stopIds, setStopIds] = useState<string[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [focus, setFocus] = useState<{ lat: number; lon: number; key: number } | null>(null)
  const [hoverBar, setHoverBar] = useState<HoverInfo | null>(null)
  const [hoverDistrict, setHoverDistrict] = useState<{ district: number; x: number; y: number } | null>(null)
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const [paths, setPaths] = useState<Record<string, [number, number][]>>({})
  const [tasteOpen, setTasteOpen] = useState(false)

  useEffect(() => {
    loadSiteData()
      .then(async (d) => {
        if (import.meta.env.DEV) {
          // Local tag edits saved since the last pipeline run.
          const rows = (await fetch('/__dev/tags').then((r) => r.json())) as TagRow[]
          d = { ...d, bars: applyTagRows(d.bars, rows) }
        }
        setData(d)
        const [p25, p75] = await loadTransitRange()
        setData((cur) => cur && { ...cur, matrices: { ...cur.matrices, transitP25: p25, transitP75: p75 } })
      })
      .catch((e) => setError(String(e)))
  }, [])

  const byId = useMemo(() => new Map(data?.bars.map((b) => [b.id, b]) ?? []), [data])
  const stops = useMemo(() => stopIds.map((id) => byId.get(id)).filter((b): b is Bar => !!b), [stopIds, byId])
  const selected = selectedId ? byId.get(selectedId) ?? null : null
  const districtNames = useMemo(() => new Map(data?.districtLabels.features.map((f) =>
    [Number(f.properties?.district), { name: String(f.properties?.name), count: Number(f.properties?.count) }]) ?? []), [data])

  const tl = useMemo(
    () => data ? timeline(stops, data.matrices, settings.weekday, settings.startMinutes, settings.stopMinutes,
      settings.walkToleranceMinutes) : [],
    [data, stops, settings],
  )

  // When would the group arrive at, and leave, the selected bar?
  const selectedTimes = useMemo(() => {
    if (!data || !selected) return null
    const inTour = tl.find((s) => s.bar.id === selected.id)
    if (inTour) return { arrival: inTour.arrival, departure: inTour.departure }
    const last = tl[tl.length - 1]
    const arrival = last
      ? last.departure + legMinutes(leg(data.matrices, last.bar.matrixIndex, selected.matrixIndex, settings.walkToleranceMinutes))
      : settings.weekday * DAY + settings.startMinutes
    return { arrival, departure: arrival + settings.stopMinutes }
  }, [data, selected, tl, settings])

  const preferences: Preferences = useMemo(() => {
    const has = group.likes.length + group.avoids.length + (group.likedTypes?.length ?? 0) + (group.avoidedTypes?.length ?? 0)
    return { ...prefs, participants: has ? [group] : [] }
  }, [prefs, group])

  const baseConstraints: Constraints = useMemo(() => ({
    blockedDistricts: new Set<number>(),
    includedDistricts: null,
    venueTypes: settings.venueTypes,
    officialEdition: settings.officialOnly ? data?.manifest.newestOfficialEdition ?? null : null,
    excludedBars: new Set<string>(),
    departureMinuteOfWeek: null,
    walkToleranceMinutes: settings.walkToleranceMinutes,
  }), [settings, data])

  const recs = useMemo(() => {
    if (!data || !selected || !selectedTimes) return []
    const blocked = new Set(stops.map((b) => b.district))
    blocked.add(selected.district)
    if (blocked.size >= ALL_DISTRICTS) return []
    return recommend(selected, data.bars, data.matrices,
      { ...baseConstraints, blockedDistricts: blocked, departureMinuteOfWeek: selectedTimes.departure },
      preferences)
  }, [data, selected, selectedTimes, stops, baseConstraints, preferences])

  const mapBars: MapBar[] = useMemo(() => {
    if (!data) return []
    const rank = new Map(recs.map((r, i) => [r.bar.id, i]))
    const stopIndex = new Map(tl.map((s, i) => [s.bar.id, i]))
    const out: MapBar[] = []
    for (const bar of data.bars) {
      const si = stopIndex.get(bar.id)
      const r = rank.get(bar.id)
      if (si === undefined && bar.id !== selected?.id && !passesFilters(bar, baseConstraints)) continue
      if (bar.id === selected?.id) {
        out.push({ bar, role: 'selected', label: si !== undefined ? si + 1 : undefined })
      } else if (si !== undefined) {
        out.push({ bar, role: 'stop', label: si + 1, closed: tl[si].closedOnArrival })
      } else if (r !== undefined) {
        out.push({ bar, role: r < 5 ? 'top' : 'next', label: r < 5 ? r + 1 : undefined })
      } else {
        // While a bar is selected, bars in districts you can't pick next fade out.
        const blocked = !!selected && (bar.district === selected.district || stops.some((s) => s.district === bar.district))
        out.push({ bar, role: 'other', dim: blocked })
      }
    }
    return out
  }, [data, recs, tl, selected, stops, baseConstraints])

  // Real walking paths for walking legs; transit legs are drawn as arcs.
  const wanted = useMemo(() => {
    const pairs: [Bar, Bar][] = []
    if (!data) return pairs
    for (let i = 1; i < tl.length; i++) if (tl[i].legIn?.mode === 'walk') pairs.push([tl[i - 1].bar, tl[i].bar])
    const h = highlightId ? byId.get(highlightId) : null
    if (selected && h && leg(data.matrices, selected.matrixIndex, h.matrixIndex, settings.walkToleranceMinutes).mode === 'walk') {
      pairs.push([selected, h])
    }
    return pairs
  }, [data, tl, highlightId, selected, byId, settings.walkToleranceMinutes])

  useEffect(() => {
    for (const [a, b] of wanted) {
      const key = pathKey(a, b)
      if (paths[key]) continue
      walkingPath(a, b).then((coords) => {
        if (coords) setPaths((p) => ({ ...p, [key]: coords }))
      })
    }
  }, [wanted, paths])

  const tourLegs: Leg[] = useMemo(() => tl.slice(1).map((s, i) => {
    const a = tl[i].bar
    const b = s.bar
    const mode = s.legIn?.mode === 'transit' ? 'transit' : 'walk'
    const coords = (mode === 'walk' && paths[pathKey(a, b)]) || (mode === 'transit'
      ? arc([a.lon, a.lat], [b.lon, b.lat])
      : [[a.lon, a.lat], [b.lon, b.lat]] as [number, number][])
    return { coords, mode }
  }), [tl, paths])

  const preview: Leg | null = useMemo(() => {
    const h = highlightId ? byId.get(highlightId) : null
    if (!data || !selected || !h) return null
    const l = leg(data.matrices, selected.matrixIndex, h.matrixIndex, settings.walkToleranceMinutes)
    if (l.mode === 'transit') return { coords: arc([selected.lon, selected.lat], [h.lon, h.lat]), mode: 'transit' }
    return { coords: paths[pathKey(selected, h)] ?? [[selected.lon, selected.lat], [h.lon, h.lat]], mode: 'walk' }
  }, [data, selected, highlightId, byId, paths, settings.walkToleranceMinutes])

  const visited = useMemo(() => new Set(stops.map((b) => b.district)), [stops])
  const recLines = useMemo(
    () => selected ? recs.slice(0, 5).filter((r) => r.bar.id !== highlightId)
      .map((r) => [[selected.lon, selected.lat], [r.bar.lon, r.bar.lat]] as [number, number][]) : [],
    [selected, recs, highlightId],
  )

  function pick(id: string, fly: boolean) {
    setSelectedId(id)
    setHighlightId(null)
    const b = byId.get(id)
    if (fly && b) setFocus({ lat: b.lat, lon: b.lon, key: Date.now() })
  }

  // Local tag edit mode exists on the dev server only (SPEC 5.5); the build drops this branch.
  const changeTag = import.meta.env.DEV
    ? async (bar: Bar, tag: string, value: 0 | 1) => {
      const r = await fetch('/__dev/tags', { method: 'POST', body: JSON.stringify({ bar_id: bar.id, tag, value: String(value) }) })
      if (!r.ok) return
      const row: TagRow = { bar_id: bar.id, tag, value: String(value), source: 'manual', evidence: '', reviewed: '1' }
      setData((d) => d && { ...d, bars: applyTagRows(d.bars, [row]) })
    }
    : undefined

  if (error) return <main className="loading">Daten konnten nicht geladen werden: {error}</main>
  if (!data) return <main className="loading"><span className="spinner" /> Lade Lokale und Fahrzeiten …</main>

  const blockedBy = selected && !stopIds.includes(selected.id) ? stops.find((b) => b.district === selected.district) ?? null : null
  const hovered = hoverBar ? byId.get(hoverBar.id) : null
  const hoverLeg = hovered && selected && hovered.id !== selected.id
    ? leg(data.matrices, selected.matrixIndex, hovered.matrixIndex, settings.walkToleranceMinutes) : null
  const hoverArrival = hoverLeg && selectedTimes && hoverLeg.mode !== 'unreachable' ? selectedTimes.departure + hoverLeg.minutes : null
  const hd = hoverDistrict && !hoverBar ? districtNames.get(hoverDistrict.district) : null

  return (
    <div className="app">
      <header className="topbar">
        <FilterBar bars={data.bars} settings={settings} onSettings={setSettings} group={group} onGroup={setGroup}
          onPick={(id) => pick(id, true)} onTaste={() => setTasteOpen(true)} />
      </header>
      <main className="planner">
        <div className="map-wrap">
          <MapView bars={mapBars} districts={data.districts} districtLabels={data.districtLabels} visitedDistricts={visited}
            tourLegs={tourLegs} recLines={recLines} preview={preview} highlightId={highlightId} focus={focus}
            onSelect={(id) => pick(id, false)} onHoverBar={setHoverBar} onHoverDistrict={setHoverDistrict} />
          {hovered && hoverBar && (
            <div className="hover-card" style={{ left: hoverBar.x + 16, top: hoverBar.y + 12 }}>
              <strong>{hovered.name}</strong> <TipBadge bar={hovered} />
              <div className="rec-meta"><TypePill bar={hovered} /> <span>{hovered.district}. Bezirk</span></div>
              {hoverLeg && <div className="hover-leg">{hoverLeg.mode === 'walk' ? '🚶' : '🚋'} {legLabel(hoverLeg)} von {selected?.name}</div>}
              <div className="chips"><TagChips bar={hovered} max={4} /> <OpenStatus bar={hovered} at={hoverArrival} /></div>
            </div>
          )}
          {hd && hoverDistrict && (
            <div className="district-tip" style={{ left: hoverDistrict.x + 14, top: hoverDistrict.y + 14 }}>
              <strong>{hoverDistrict.district}. {hd.name}</strong>
              <span>{hd.count} Lokale{visited.has(hoverDistrict.district) ? ' · ✓ in der Tour' : ''}</span>
            </div>
          )}
        </div>
        <aside className="panel">
          <BarPanel bar={selected} arrival={selectedTimes?.arrival ?? null} blockedBy={blockedBy}
            inTour={!!selected && stopIds.includes(selected.id)} newestEdition={data.manifest.newestOfficialEdition}
            onAdd={() => selected && setStopIds((ids) => [...ids, selected.id])} onClose={() => setSelectedId(null)}
            onTagChange={changeTag} />
          {selected && (
            <Recommendations recs={recs} preferences={preferences} departure={selectedTimes?.departure ?? null}
              onPreferences={(p) => setPrefs({ similarity: p.similarity, speedVsMatch: p.speedVsMatch })}
              onPreview={(id) => pick(id, true)} onHover={setHighlightId} />
          )}
          <TourPanel stops={tl} districtCount={ALL_DISTRICTS} onSelect={(id) => pick(id, true)}
            onRemove={(id) => setStopIds((ids) => ids.filter((x) => x !== id))} />
        </aside>
      </main>
      <Footer />
      {tasteOpen && (
        <TasteFinder bars={data.bars} onClose={() => setTasteOpen(false)}
          onDone={(p) => { setGroup(p); setTasteOpen(false); setPrefs((cur) => ({ ...cur, speedVsMatch: Math.max(cur.speedVsMatch, 0.6) })) }} />
      )}
    </div>
  )
}
