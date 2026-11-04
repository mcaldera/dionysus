import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { OpenStatus, TagChips, TipBadge, TypePill } from './components/BarFacts'
import BarPanel from './components/BarPanel'
import FilterBar, { type Settings } from './components/FilterBar'
import Footer from './components/Footer'
import MapView, { type HoverInfo, type Leg, type MapBar } from './components/MapView'
import Proposals, { type ProposalState } from './components/Proposals'
import Recommendations from './components/Recommendations'
import TasteFinder from './components/TasteFinder'
import TourPanel from './components/TourPanel'
import { loadSiteData, loadTransitRange, type SiteData } from './data'
import { arc } from './domain/geo'
import { DAY } from './domain/hours'
import { passesFilters, recommend, refine, type Constraints, type Preferences } from './domain/recommend'
import { swapOptions } from './domain/solver'
import { applyTagRows, type TagRow } from './domain/tagRows'
import { timeline, type TimelineStop } from './domain/tour'
import { leg, legLabel, legMinutes } from './domain/travel'
import { ALL_DISTRICTS, VENUE_TYPES, type Bar, type Participant } from './domain/types'
import { transitPath, walkingPath, type TransitRoute } from './routes'
import { CancelledError, SolverChannel } from './worker/client'
import type { SolveRequest, TourResult } from './worker/protocol'
import './styles.css'

function walkKey(a: Bar, b: Bar): string {
  return `${a.id}>${b.id}`
}

/** Transit routes depend on the departure time, rounded like routes.ts does. */
function transitKey(a: Bar, b: Bar, departure: number): string {
  return `${a.id}>${b.id}@${Math.round(departure / 15) * 15}`
}

type Pair = { a: Bar; b: Bar; mode: 'walk' | 'transit'; departure: number }

export default function App() {
  const [data, setData] = useState<SiteData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [settings, setSettings] = useState<Settings>({
    weekday: 5, startMinutes: 11 * 60, stopMinutes: 20, walkToleranceMinutes: 5,
    venueTypes: new Set(VENUE_TYPES), officialOnly: false, districts: ALL_DISTRICTS, endDistrict: null,
  })
  const [group, setGroup] = useState<Participant>({ name: 'Wir', likes: [], avoids: [] })
  const [prefs, setPrefs] = useState<Omit<Preferences, 'participants'>>({ similarity: 'similar', speedVsMatch: 0.5 })
  const [stopIds, setStopIds] = useState<string[]>([])
  const [pinned, setPinned] = useState<Set<string>>(new Set())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [focus, setFocus] = useState<{ lat: number; lon: number; key: number } | null>(null)
  const [hoverBar, setHoverBar] = useState<HoverInfo | null>(null)
  const [hoverDistrict, setHoverDistrict] = useState<{ district: number; x: number; y: number } | null>(null)
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const [paths, setPaths] = useState<Record<string, [number, number][]>>({})
  const [transit, setTransit] = useState<Record<string, TransitRoute | null>>({})
  const [tasteOpen, setTasteOpen] = useState(false)
  const [proposals, setProposals] = useState<ProposalState | null>(null)
  const [activeProposal, setActiveProposal] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  const [swapIndex, setSwapIndex] = useState<number | null>(null)
  const [fit, setFit] = useState<{ key: string; extras: Map<string, number>; done: boolean } | null>(null)

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

  // Two solver workers: one for planning, one for refining recommendations, so a click
  // on the map doesn't cancel a proposal that is being computed.
  const bars = data?.bars
  const walk = data?.matrices.walk
  const transitP50 = data?.matrices.transitP50
  const n = data?.manifest.n
  const channels = useMemo(() => {
    if (!bars || !walk || !transitP50 || !n) return null
    const m = { n, walk, transitP50 }
    return { plan: new SolverChannel(bars, m), refine: new SolverChannel(bars, m) }
  }, [bars, walk, transitP50, n])
  useEffect(() => () => { channels?.plan.dispose(); channels?.refine.dispose() }, [channels])

  const byId = useMemo(() => new Map(data?.bars.map((b) => [b.id, b]) ?? []), [data])
  const stops = useMemo(() => stopIds.map((id) => byId.get(id)).filter((b): b is Bar => !!b), [stopIds, byId])
  const selected = selectedId ? byId.get(selectedId) ?? null : null
  const districtNames = useMemo(() => new Map(data?.districtLabels.features.map((f) =>
    [Number(f.properties?.district), { name: String(f.properties?.name), count: Number(f.properties?.count) }]) ?? []), [data])
  const districtName = useCallback((d: number) => `${d}. ${districtNames.get(d)?.name ?? 'Bezirk'}`, [districtNames])
  const included = useMemo(() => new Set(settings.districts), [settings.districts])

  const makeTimeline = useCallback(
    (list: Bar[]) => data ? timeline(list, data.matrices, settings.weekday, settings.startMinutes, settings.stopMinutes,
      settings.walkToleranceMinutes) : [],
    [data, settings],
  )
  const tl = useMemo(() => makeTimeline(stops), [makeTimeline, stops])

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

  const solveBase = useMemo(() => ({
    districts: settings.districts, filters: baseConstraints, participants: preferences.participants,
    // λ: minutes of extra travel worth 1.0 of match; 5 at the slider's middle (SPEC 9).
    lambda: 10 * preferences.speedVsMatch,
    weekday: settings.weekday, startMinutes: settings.startMinutes, stopMinutes: settings.stopMinutes,
    startDistrict: null, endDistrict: settings.endDistrict, restarts: 3, seed: 1,
  }), [settings, baseConstraints, preferences])

  const recs = useMemo(() => {
    if (!data || !selected || !selectedTimes || swapIndex !== null) return []
    const blocked = new Set(stops.map((b) => b.district))
    blocked.add(selected.district)
    if (settings.districts.every((d) => blocked.has(d))) return []
    return recommend(selected, data.bars, data.matrices,
      { ...baseConstraints, includedDistricts: included, blockedDistricts: blocked, departureMinuteOfWeek: selectedTimes.departure },
      preferences)
  }, [data, selected, selectedTimes, stops, baseConstraints, included, preferences, settings.districts, swapIndex])

  // Refine stage (SPEC 8.3): how much longer the best remaining tour gets through each candidate.
  // Only from the end of the tour; from a stop in the middle the question doesn't apply.
  const fitPrefix = useMemo(() => {
    if (!selected) return null
    const idx = stopIds.indexOf(selected.id)
    if (idx >= 0 && idx !== stopIds.length - 1) return null
    return idx >= 0 ? stopIds : [...stopIds, selected.id]
  }, [selected, stopIds])
  const fitKey = useMemo(() => fitPrefix && recs.length
    ? JSON.stringify([fitPrefix, recs.map((r) => r.bar.id), solveBase.lambda, settings]) : null, [fitPrefix, recs, solveBase, settings])

  useEffect(() => {
    if (!channels || !fitKey || !fitPrefix) {
      channels?.refine.cancel()
      return
    }
    const extras = new Map<string, number>()
    setFit({ key: fitKey, extras, done: false })
    const options: SolveRequest = { ...solveBase, prefix: fitPrefix, pinned: [] }
    channels.refine.run({ type: 'tourFit', options, candidates: recs.map((r) => r.bar.id) }, {
      onFit: (id, extra) => {
        extras.set(id, extra)
        setFit({ key: fitKey, extras: new Map(extras), done: false })
      },
    }).then(() => setFit({ key: fitKey, extras, done: true }), (e) => { if (!(e instanceof CancelledError)) console.error(e) })
    // recs and fitPrefix are captured through fitKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channels, fitKey])

  const refinedRecs = useMemo(
    () => (fit && fit.key === fitKey ? refine(recs, fit.extras, preferences) : recs),
    [fit, fitKey, recs, preferences],
  )
  const refining = !!fitKey && !(fit?.key === fitKey && fit.done)

  // Swapping a stop: other bars of its district, ranked by fit between its neighbours.
  const swap = useMemo(() => {
    if (!data || swapIndex === null || swapIndex >= stops.length) return null
    return { index: swapIndex, options: swapOptions(stops, swapIndex, data.bars, data.matrices, solveBase) }
  }, [data, swapIndex, stops, solveBase])

  const proposalTimelines = useMemo(() => proposals?.tours ?? [], [proposals])
  const previewTl: TimelineStop[] | null = proposals && proposalTimelines.length
    ? proposalTimelines[Math.min(activeProposal, proposalTimelines.length - 1)] : null
  const mapTl = previewTl ?? tl

  const mapBars: MapBar[] = useMemo(() => {
    if (!data) return []
    const rank = new Map((swap ? swap.options.map((o) => o.bar) : refinedRecs.map((r) => r.bar)).map((b, i) => [b.id, i]))
    const stopIndex = new Map(mapTl.map((s, i) => [s.bar.id, i]))
    const swapped = swap ? stops[swap.index]?.id : null
    const focusId = swapped ?? selected?.id
    const out: MapBar[] = []
    for (const bar of data.bars) {
      const si = stopIndex.get(bar.id)
      const r = rank.get(bar.id)
      if (si === undefined && bar.id !== focusId && !passesFilters(bar, baseConstraints)) continue
      if (bar.id === focusId) {
        out.push({ bar, role: 'selected', label: si !== undefined ? si + 1 : undefined })
      } else if (si !== undefined) {
        out.push({ bar, role: 'stop', label: si + 1, closed: mapTl[si].closedOnArrival })
      } else if (r !== undefined) {
        out.push({ bar, role: r < 5 ? 'top' : 'next', label: r < 5 ? r + 1 : undefined })
      } else {
        // Fade bars you can't pick next, and districts outside the plan.
        const blocked = !included.has(bar.district) || (!!selected && !swap
          && (bar.district === selected.district || stops.some((s) => s.district === bar.district)))
        out.push({ bar, role: 'other', dim: blocked })
      }
    }
    return out
  }, [data, refinedRecs, swap, mapTl, selected, stops, baseConstraints, included])

  const highlighted = highlightId ? byId.get(highlightId) ?? null : null
  // The bar a highlighted recommendation or swap option is reached from.
  const previewFrom = swap ? stops[swap.index - 1] ?? null : selected

  // Legs we want real paths for: the tour itself and the previewed leg. Proposal previews stay schematic.
  const wanted = useMemo(() => {
    const pairs: Pair[] = []
    if (!data) return pairs
    for (let i = 1; i < tl.length; i++) {
      const l = tl[i].legIn
      if (l && l.mode !== 'unreachable') pairs.push({ a: tl[i - 1].bar, b: tl[i].bar, mode: l.mode, departure: tl[i - 1].departure })
    }
    if (previewFrom && highlighted) {
      const l = leg(data.matrices, previewFrom.matrixIndex, highlighted.matrixIndex, settings.walkToleranceMinutes)
      const departure = tl.find((s) => s.bar.id === previewFrom.id)?.departure ?? selectedTimes?.departure
      if (l.mode !== 'unreachable' && departure !== undefined) pairs.push({ a: previewFrom, b: highlighted, mode: l.mode, departure })
    }
    return pairs
  }, [data, tl, previewFrom, highlighted, selectedTimes, settings.walkToleranceMinutes])

  useEffect(() => {
    const missing: Pair[] = []
    for (const pair of wanted) {
      const { a, b, mode, departure } = pair
      if (mode === 'walk') {
        const key = walkKey(a, b)
        if (paths[key]) continue
        walkingPath(a, b).then((coords) => { if (coords) setPaths((p) => ({ ...p, [key]: coords })) })
      } else if (!(transitKey(a, b, departure) in transit)) {
        missing.push(pair)
      }
    }
    if (!missing.length) return
    // Hovering through a list shouldn't fire a request per row: wait a moment.
    // transitPath caches its promises, so repeated scheduling never repeats a request.
    const t = setTimeout(() => {
      for (const { a, b, departure } of missing) {
        const key = transitKey(a, b, departure)
        transitPath(a, b, departure).then((route) => setTransit((cur) => ({ ...cur, [key]: route })), () => {})
      }
    }, 350)
    return () => clearTimeout(t)
  }, [wanted, paths, transit])

  const drawLeg = useCallback((a: Bar, b: Bar, mode: 'walk' | 'transit', departure: number | null, live: boolean): Leg[] => {
    if (mode === 'walk') {
      return [{ coords: (live && paths[walkKey(a, b)]) || [[a.lon, a.lat], [b.lon, b.lat]], mode: 'walk' }]
    }
    const key = departure !== null ? transitKey(a, b, departure) : ''
    const route = live ? transit[key] : undefined
    if (!route) {
      // undefined: still loading (or not requested); null: the router found no transit connection.
      return [{ coords: arc([a.lon, a.lat], [b.lon, b.lat]), mode: route === null ? 'transfer' : 'pending' }]
    }
    return route.segments.map((s) => ({ coords: s.coords, mode: s.kind === 'ride' ? 'ride' : 'transfer', color: s.color, line: s.line }))
  }, [paths, transit])

  const tourLegs: Leg[] = useMemo(() => mapTl.slice(1).flatMap((s, i) => {
    const l = s.legIn
    if (!l || l.mode === 'unreachable') return []
    return drawLeg(mapTl[i].bar, s.bar, l.mode, mapTl[i].departure, !previewTl)
  }), [mapTl, previewTl, drawLeg])

  const preview: Leg[] = useMemo(() => {
    if (!data || !previewFrom || !highlighted) return []
    const l = leg(data.matrices, previewFrom.matrixIndex, highlighted.matrixIndex, settings.walkToleranceMinutes)
    if (l.mode === 'unreachable') return []
    const departure = tl.find((s) => s.bar.id === previewFrom.id)?.departure ?? selectedTimes?.departure ?? null
    return drawLeg(previewFrom, highlighted, l.mode, departure, true)
  }, [data, previewFrom, highlighted, tl, selectedTimes, settings.walkToleranceMinutes, drawLeg])

  const tourRoutes = useMemo(() => tl.map((s, i) => i > 0 && s.legIn?.mode === 'transit'
    ? transit[transitKey(tl[i - 1].bar, s.bar, tl[i - 1].departure)] : undefined), [tl, transit])

  const visited = useMemo(() => new Set(mapTl.map((s) => s.bar.district)), [mapTl])
  const recLines = useMemo(
    () => selected && !swap ? refinedRecs.slice(0, 5).filter((r) => r.bar.id !== highlightId)
      .map((r) => [[selected.lon, selected.lat], [r.bar.lon, r.bar.lat]] as [number, number][]) : [],
    [selected, swap, refinedRecs, highlightId],
  )

  function pick(id: string, fly: boolean) {
    setSelectedId(id)
    setHighlightId(null)
    setSwapIndex(null)
    const b = byId.get(id)
    if (fly && b) setFocus({ lat: b.lat, lon: b.lon, key: Date.now() })
  }

  function clearSelection() {
    setSelectedId(null)
    setHighlightId(null)
    setSwapIndex(null)
  }

  const toBars = useCallback((r: TourResult) => r.stops.map((id) => byId.get(id)).filter((b): b is Bar => !!b), [byId])

  function propose(from: Bar | null) {
    if (!channels) return
    setActiveProposal(0)
    setProposals({ title: from ? `Touren ab ${from.name}` : 'Tourvorschläge', running: true, progress: 0, tours: [] })
    setSelectedId(null)
    const options: SolveRequest = { ...solveBase, prefix: from ? [from.id] : [], pinned: [] }
    channels.plan.run({ type: 'propose', options, count: 3 }, {
      onProgress: (done, total) => setProposals((p) => p && { ...p, progress: done / total }),
    }).then((tours) => {
      setProposals((p) => p && { ...p, running: false, progress: 1, tours: tours.map((t) => makeTimeline(toBars(t))) })
    }, (e) => { if (!(e instanceof CancelledError)) setProposals((p) => p && { ...p, running: false }) })
  }

  function applyProposal(i: number) {
    const t = proposalTimelines[i]
    if (!t) return
    setStopIds(t.map((s) => s.bar.id))
    setPinned((cur) => new Set(t.filter((s) => cur.has(s.bar.id)).map((s) => s.bar.id)))
    setProposals(null)
    channels?.plan.cancel()
  }

  function solveInto(label: string, options: SolveRequest) {
    if (!channels) return
    setBusy(label)
    setSwapIndex(null)
    channels.plan.run({ type: 'solve', options }).then((tours) => {
      setBusy(null)
      if (tours[0]) setStopIds(tours[0].stops)
    }, (e) => { if (!(e instanceof CancelledError)) setBusy(null) })
  }

  /** "Tour für mich fertig planen": keep the stops so far, in order, and plan the rest. */
  function finishTour() {
    solveInto('Plane die restlichen Bezirke …', { ...solveBase, prefix: stopIds, pinned: [] })
  }

  /** Keep pinned bars (a pinned first stop stays the start), choose everything else anew. */
  function optimizeTour() {
    const first = stopIds[0] && pinned.has(stopIds[0]) ? [stopIds[0]] : []
    const keep = stopIds.filter((id) => pinned.has(id) && id !== first[0])
    const districts = [...new Set([...settings.districts, ...stopIds.filter((id) => pinned.has(id)).map((id) => byId.get(id)!.district)])]
    solveInto('Optimiere die Tour …', { ...solveBase, districts, prefix: first, pinned: keep })
  }

  function replaceStop(index: number, id: string) {
    setStopIds((ids) => ids.map((x, i) => (i === index ? id : x)))
    setPinned((cur) => new Set([...cur, id]))
    setSwapIndex(null)
    setHighlightId(null)
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

  // Escape leaves the current selection or swap, like a click on empty map.
  const escRef = useRef(clearSelection)
  escRef.current = clearSelection
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !tasteOpen) escRef.current() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [tasteOpen])

  if (error) return <main className="loading">Daten konnten nicht geladen werden: {error}</main>
  if (!data) return <main className="loading"><span className="spinner" /> Lade Lokale und Fahrzeiten …</main>

  const blockedBy = selected && !stopIds.includes(selected.id) ? stops.find((b) => b.district === selected.district) ?? null : null
  const hovered = hoverBar ? byId.get(hoverBar.id) : null
  const hoverFrom = swap ? stops[swap.index - 1] ?? null : selected
  const hoverLeg = hovered && hoverFrom && hovered.id !== hoverFrom.id
    ? leg(data.matrices, hoverFrom.matrixIndex, hovered.matrixIndex, settings.walkToleranceMinutes) : null
  const hoverDeparture = hoverFrom ? tl.find((s) => s.bar.id === hoverFrom.id)?.departure ?? selectedTimes?.departure ?? null : null
  const hoverArrival = hoverLeg && hoverDeparture !== null && hoverLeg.mode !== 'unreachable' ? hoverDeparture + hoverLeg.minutes : null
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
            onSelect={(id) => pick(id, false)} onBackgroundClick={clearSelection}
            onHoverBar={setHoverBar} onHoverDistrict={setHoverDistrict} />
          {hovered && hoverBar && (
            <div className="hover-card" style={{ left: hoverBar.x + 16, top: hoverBar.y + 12 }}>
              <strong>{hovered.name}</strong> <TipBadge bar={hovered} />
              <div className="rec-meta"><TypePill bar={hovered} /> <span>{hovered.district}. Bezirk</span></div>
              {hoverLeg && <div className="hover-leg">{hoverLeg.mode === 'walk' ? '🚶' : '🚋'} {legLabel(hoverLeg)} von {hoverFrom?.name}</div>}
              <div className="chips"><TagChips bar={hovered} max={4} /> <OpenStatus bar={hovered} at={hoverArrival} /></div>
            </div>
          )}
          {hd && hoverDistrict && (
            <div className="district-tip" style={{ left: hoverDistrict.x + 14, top: hoverDistrict.y + 14 }}>
              <strong>{hoverDistrict.district}. {hd.name}</strong>
              <span>{hd.count} Lokale{visited.has(hoverDistrict.district) ? ' · ✓ in der Tour' : ''}
                {!included.has(hoverDistrict.district) ? ' · nicht in der Planung' : ''}</span>
            </div>
          )}
          <div className="map-legend" aria-label="Legende Wege">
            <span><i className="lg walk" /> zu Fuß</span>
            <span><i className="lg ride" /> Öffi-Linie (schnellste Verbindung)</span>
            <span><i className="lg pending" /> Öffis, Strecke wird geladen</span>
          </div>
        </div>
        <aside className="panel">
          {proposals && (
            <Proposals state={proposals} participants={preferences.participants} districtName={districtName}
              active={activeProposal} onHover={setActiveProposal} onApply={applyProposal}
              onClose={() => { setProposals(null); channels?.plan.cancel() }} />
          )}
          {(selected || !proposals) && <BarPanel bar={selected} arrival={selectedTimes?.arrival ?? null} blockedBy={blockedBy}
            inTour={!!selected && stopIds.includes(selected.id)} newestEdition={data.manifest.newestOfficialEdition}
            tourEmpty={stopIds.length === 0} busy={!!busy || !!proposals?.running}
            onAdd={() => {
              if (!selected) return
              setStopIds((ids) => [...ids, selected.id])
              setPinned((cur) => new Set([...cur, selected.id]))
            }}
            onReplace={() => selected && blockedBy && replaceStop(stopIds.indexOf(blockedBy.id), selected.id)}
            onPropose={() => propose(selected)}
            onClose={clearSelection} onTagChange={changeTag} />}
          {selected && !swap && (
            <Recommendations recs={refinedRecs} preferences={preferences} departure={selectedTimes?.departure ?? null}
              refining={refining}
              onPreferences={(p) => setPrefs({ similarity: p.similarity, speedVsMatch: p.speedVsMatch })}
              onPreview={(id) => pick(id, true)} onHover={setHighlightId} />
          )}
          <TourPanel stops={tl} districtCount={settings.districts.length} pinned={pinned} routes={tourRoutes} swap={swap}
            busy={busy} onSelect={(id) => pick(id, true)}
            onRemove={(id) => { setStopIds((ids) => ids.filter((x) => x !== id)); setSwapIndex(null) }}
            onTogglePin={(id) => setPinned((cur) => {
              const next = new Set(cur)
              if (next.has(id)) next.delete(id)
              else next.add(id)
              return next
            })}
            onSwap={(i) => {
              setSwapIndex(i)
              setSelectedId(null)
              setHighlightId(null)
              const b = i !== null ? stops[i] : null
              if (b) setFocus({ lat: b.lat, lon: b.lon, key: Date.now() })
            }}
            onPickSwap={(id) => swap && replaceStop(swap.index, id)}
            onHoverSwap={setHighlightId}
            onFinish={finishTour} onOptimize={optimizeTour}
            onClear={() => { setStopIds([]); setPinned(new Set()); setSwapIndex(null) }} />
        </aside>
      </main>
      <Footer />
      {tasteOpen && (
        <TasteFinder onClose={() => setTasteOpen(false)}
          onDone={(p) => { setGroup(p); setTasteOpen(false); setPrefs((cur) => ({ ...cur, speedVsMatch: Math.max(cur.speedVsMatch, 0.6) })) }} />
      )}
    </div>
  )
}
