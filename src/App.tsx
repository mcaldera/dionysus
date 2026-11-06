import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { OpenStatus, TagChips, TipBadge, TypePill } from './components/BarFacts'
import BarPanel from './components/BarPanel'
import DistrictCard from './components/DistrictCard'
import FilterMenu, { type AppMode } from './components/FilterMenu'
import Atlas from './components/Atlas'
import Icon, { ModeIcon } from './components/Icon'
import { MapButtons, MapToast, NearbyList } from './components/Finder'
import Footer from './components/Footer'
import MapView, { SIZE_FACTORS, SIZE_STEPS, type HoverInfo, type Leg, type MapBar, type SizeBy } from './components/MapView'
import MyBars, { MineImport } from './components/MyBars'
import Panel, { type Snap } from './components/Panel'
import PlanDialog, { type PlanSettings } from './components/PlanDialog'
import Proposals, { type ProposalState } from './components/Proposals'
import Recommendations from './components/Recommendations'
import TasteFinder from './components/TasteFinder'
import TourPanel from './components/TourPanel'
import TourStats from './components/TourStats'
import { loadAtlas, loadSiteData, loadTransitRange, type SiteData } from './data'
import type { AtlasData } from './domain/atlas'
import { districtStats } from './domain/districtStats'
import { matchesFilter, strongTips, type MapFilter } from './domain/filter'
import { arc } from './domain/geo'
import { download, tourGpx, tourTable, xlsx } from './domain/export'
import { DAY, WEEKDAYS, clock } from './domain/hours'
import { recommend, refine, type Constraints, type Preferences } from './domain/recommend'
import { slotDelta, slotOptions, type Slot } from './domain/solver'
import { applyTagRows, type TagRow } from './domain/tagRows'
import { slotTimeline, timeline, type TimelineStop } from './domain/tour'
import { decodeMine } from './domain/mine'
import { nearbyFromBar, nearbyFromPoint, reachFromBar, reachFromPoint, walkEstimate, type NearbyResult } from './domain/nearby'
import { googleMapsDirections, leg, legLabel, legMinutes } from './domain/travel'
import { ALL_DISTRICTS, VENUE_TYPES, type Bar, type Participant } from './domain/types'
import { ridesBack, transitPath, walkingPath, type TransitRoute } from './routes'
import { loadJson, saveJson } from './storage'
import { TYPE_COLOR, TYPE_SHORT } from './theme'
import { nowMinuteOfWeek } from './time'
import { PHONE, useMedia } from './useMedia'
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
/** Finder with "Öffis" on: ride when that saves more than this many minutes. */
const FINDER_TOLERANCE = 2
/** Desktop: map pixels behind the floating panel (its width plus margins). */
const PANEL_INSET = 434
/**
 * Finder: where bars are searched from. A free point (location, marker) or a bar; it stays
 * while you look at other bars, until you clear it.
 */
type Origin = { lat: number; lon: number; label: string; barId?: string; gps?: boolean }
/** A tour place: a district with a chosen bar, or still open. */
type SlotIds = { district: number; barId: string | null }

export default function App() {
  const [data, setData] = useState<SiteData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [plan, setPlan] = useState<PlanSettings>({
    weekday: 5, startMinutes: 11 * 60, stopMinutes: 20, walkToleranceMinutes: 5, districts: ALL_DISTRICTS,
    startDistrict: null, endDistrict: null, venueTypes: new Set(VENUE_TYPES), officialOnly: false, mineFirst: false, noBacktrack: true,
  })
  const [filter, setFilter] = useState<MapFilter>({ venueTypes: new Set(VENUE_TYPES), tags: new Set(), sources: new Set(), tipKinds: new Set(), weakTips: false, openAt: null, includeUnknownHours: true })
  const [group, setGroup] = useState<Participant>({ name: 'Wir', likes: [], avoids: [] })
  const [prefs, setPrefs] = useState<Omit<Preferences, 'participants'>>({ similarity: 'similar', speedVsMatch: 0.5 })
  const [slotIds, setSlotIds] = useState<SlotIds[]>([])
  const [pinned, setPinned] = useState<Set<string>>(new Set())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [focus, setFocus] = useState<{ lat: number; lon: number; key: number } | null>(null)
  const [hoverBar, setHoverBar] = useState<HoverInfo | null>(null)
  const [hoverDistrict, setHoverDistrict] = useState<{ district: number; x: number; y: number } | null>(null)
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const [paths, setPaths] = useState<Record<string, [number, number][]>>({})
  const [transit, setTransit] = useState<Record<string, TransitRoute | null>>({})
  const [tasteOpen, setTasteOpen] = useState(false)
  const [planOpen, setPlanOpen] = useState(false)
  const [proposals, setProposals] = useState<ProposalState | null>(null)
  const [activeProposal, setActiveProposal] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  const [swapIndex, setSwapIndex] = useState<number | null>(null)
  const [focusDistrict, setFocusDistrict] = useState<number | null>(null)
  // Beisl-Finder
  const [mode, setModeState] = useState<AppMode>(() => loadJson<AppMode>('mode', 'finder'))
  const [now, setNow] = useState(() => nowMinuteOfWeek())
  /** null = now; else a chosen minute of the week. */
  const [finderTime, setFinderTime] = useState<number | null>(null)
  /** all: no hours check; open: known open or unknown hours; sure: known to be open. */
  const [openMode, setOpenMode] = useState<'all' | 'open' | 'sure'>('sure')
  const onlyOpen = openMode !== 'all'
  const [maxMinutes, setMaxMinutes] = useState(10)
  const [finderTransit, setFinderTransit] = useState(false)
  const [point, setPoint] = useState<Origin | null>(null)
  const [placing, setPlacing] = useState(false)
  const [locating, setLocating] = useState(false)
  const [locateError, setLocateError] = useState<string | null>(null)
  // "Meine Lokale"; the storage key is the older Merkliste's, so lists saved before carry over.
  const [mine, setMine] = useState<string[]>(() => loadJson<string[]>('merkliste', []))
  const [onlyMine, setOnlyMine] = useState(false)
  /** A list opened from a share link, waiting to be taken over or dismissed. */
  const [incoming, setIncoming] = useState<string[] | null>(() => decodeMine(location.hash))
  const phone = useMedia(PHONE)
  const [snap, setSnap] = useState<Snap>('half')
  /** Phone: the focused district's figures fill the sheet only when asked for. */
  const [statsOpen, setStatsOpen] = useState(false)
  const [sheetHeight, setSheetHeight] = useState(0)

  useEffect(() => {
    const t = setInterval(() => setNow(nowMinuteOfWeek()), 30_000)
    return () => clearInterval(t)
  }, [])
  useEffect(() => saveJson('merkliste', mine), [mine])
  // A list link pasted into a tab that already shows the site only changes the hash.
  useEffect(() => {
    const onHash = () => setIncoming(decodeMine(location.hash))
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
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
  const byIndex = useMemo(() => new Map(data?.bars.map((b) => [b.matrixIndex, b]) ?? []), [data])
  const slots: Slot[] = useMemo(
    () => slotIds.map((s) => ({ district: s.district, bar: s.barId ? byId.get(s.barId) ?? null : null })), [slotIds, byId])
  const stops = useMemo(() => slots.flatMap((s) => (s.bar ? [s.bar] : [])), [slots])
  const stopIds = useMemo(() => stops.map((b) => b.id), [stops])
  const selected = selectedId ? byId.get(selectedId) ?? null : null
  const districtInfo = useMemo(() => new Map(data?.districtLabels.features.map((f) => {
    const [lon, lat] = (f.geometry as GeoJSON.Point).coordinates
    return [Number(f.properties?.district), { name: String(f.properties?.name), count: Number(f.properties?.count), lon, lat }]
  }) ?? []), [data])
  const districtName = useCallback((d: number) => `${d}. ${districtInfo.get(d)?.name ?? 'Bezirk'}`, [districtInfo])
  const included = useMemo(() => new Set(plan.districts), [plan.districts])
  const mineSet = useMemo(() => new Set(mine), [mine])
  const mineBars = useMemo(() => mine.map((id) => byId.get(id)).filter((b): b is Bar => !!b), [mine, byId])
  const mineDistricts = useMemo(() => new Set(mineBars.map((b) => b.district)), [mineBars])

  const makeTimeline = useCallback(
    (list: Bar[]) => data ? timeline(list, data.matrices, plan.weekday, plan.startMinutes, plan.stopMinutes,
      plan.walkToleranceMinutes) : [],
    [data, plan],
  )
  const slotViews = useMemo(() => data ? slotTimeline(slots, data.matrices, plan.weekday, plan.startMinutes,
    plan.stopMinutes, plan.walkToleranceMinutes) : [], [data, slots, plan])
  const tl = useMemo(() => slotViews.flatMap((v) => (v.stop ? [v.stop] : [])), [slotViews])

  // When would the group arrive at, and leave, the selected bar?
  const selectedTimes = useMemo(() => {
    if (!data || !selected) return null
    const inTour = tl.find((s) => s.bar.id === selected.id)
    if (inTour) return { arrival: inTour.arrival, departure: inTour.departure }
    const last = tl[tl.length - 1]
    const arrival = last
      ? last.departure + legMinutes(leg(data.matrices, last.bar.matrixIndex, selected.matrixIndex, plan.walkToleranceMinutes))
      : plan.weekday * DAY + plan.startMinutes
    return { arrival, departure: arrival + plan.stopMinutes }
  }, [data, selected, tl, plan])

  const preferences: Preferences = useMemo(() => {
    const has = group.likes.length + group.avoids.length + (group.likedTypes?.length ?? 0) + (group.avoidedTypes?.length ?? 0)
    return { ...prefs, participants: has ? [group] : [] }
  }, [prefs, group])

  // The planner's own constraints (plan dialog), independent of the map filter.
  const planConstraints: Constraints = useMemo(() => ({
    blockedDistricts: new Set<number>(),
    includedDistricts: null,
    venueTypes: plan.venueTypes,
    officialEdition: plan.officialOnly ? data?.manifest.newestOfficialEdition ?? null : null,
    // "Meine Lokale zuerst": where you have own bars, the others of that district are left out.
    excludedBars: new Set(plan.mineFirst ? (data?.bars ?? []).filter((b) => mineDistricts.has(b.district) && !mineSet.has(b.id)).map((b) => b.id) : []),
    departureMinuteOfWeek: null,
    walkToleranceMinutes: plan.walkToleranceMinutes,
  }), [plan, data, mineDistricts, mineSet])

  // Legs that real routes showed to ride back on the line just used ("Gleiche Linie hin und
  // zurück"); with "nicht hin und zurück" the solver avoids them from then on.
  const [avoidLegs, setAvoidLegs] = useState<[string, string][]>([])
  const solveBase = useMemo(() => ({
    districts: plan.districts, filters: planConstraints, participants: preferences.participants,
    // λ: minutes of extra travel worth 1.0 of match; 5 at the slider's middle (SPEC 9).
    lambda: 10 * preferences.speedVsMatch,
    weekday: plan.weekday, startMinutes: plan.startMinutes, stopMinutes: plan.stopMinutes,
    startDistrict: null, endDistrict: plan.endDistrict, noBacktrack: plan.noBacktrack, avoidLegs, restarts: 3, seed: 1,
  }), [plan, planConstraints, preferences, avoidLegs])

  // What you see on the map is also what recommendation and swap lists offer.
  const finder = mode === 'finder'
  const atlas = mode === 'atlas'
  const finderMinute = finderTime ?? now
  // The finder shows what is open at its time (now by default); the tour uses the filter as set.
  const baseFilter = useMemo(() => (onlyMine ? { ...filter, mine: mineSet } : filter), [filter, onlyMine, mineSet])
  const shownFilter = useMemo(() => (finder && onlyOpen
    ? { ...baseFilter, openAt: finderMinute, includeUnknownHours: openMode === 'open' } : baseFilter), [finder, onlyOpen, openMode, baseFilter, finderMinute])
  const visibleBars = useMemo(() => data?.bars.filter((b) => matchesFilter(b, shownFilter)) ?? [], [data, shownFilter])
  const listOptions = useMemo(() => ({
    ...solveBase, filters: { ...planConstraints, venueTypes: new Set(VENUE_TYPES), officialEdition: null, excludedBars: new Set<string>() },
  }), [solveBase, planConstraints])

  const recs = useMemo(() => {
    if (finder || !data || !selected || !selectedTimes || swapIndex !== null) return []
    const blocked = new Set(stops.map((b) => b.district))
    blocked.add(selected.district)
    if (plan.districts.every((d) => blocked.has(d))) return []
    return recommend(selected, visibleBars, data.matrices,
      { ...listOptions.filters, includedDistricts: included, blockedDistricts: blocked, departureMinuteOfWeek: selectedTimes.departure },
      preferences)
  }, [finder, data, selected, selectedTimes, stops, visibleBars, listOptions, included, preferences, plan.districts, swapIndex])

  // Refine stage (SPEC 8.3): how much longer the best remaining tour gets through each candidate.
  // Only from the end of the tour; from a stop in the middle the question doesn't apply.
  const fitPrefix = useMemo(() => {
    if (!selected) return null
    const idx = stopIds.indexOf(selected.id)
    if (idx >= 0 && idx !== stopIds.length - 1) return null
    return idx >= 0 ? stopIds : [...stopIds, selected.id]
  }, [selected, stopIds])
  const fitKey = useMemo(() => fitPrefix && recs.length
    ? JSON.stringify([fitPrefix, recs.map((r) => r.bar.id), solveBase.lambda, plan.weekday, plan.startMinutes,
      plan.stopMinutes, plan.walkToleranceMinutes, plan.districts, plan.noBacktrack]) : null, [fitPrefix, recs, solveBase, plan])

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

  // Finder: what is reachable from the origin (a bar or a point). Looking at other bars keeps it.
  const originBar = point?.barId ? byId.get(point.barId) ?? null : null
  const nearby: NearbyResult[] = useMemo(() => {
    if (!data || !finder || !point) return []
    const o = {
      maxMinutes, transit: finderTransit, walkToleranceMinutes: FINDER_TOLERANCE,
      departure: onlyOpen ? finderMinute : null, includeUnknownHours: openMode === 'open',
    }
    return originBar ? nearbyFromBar(originBar, visibleBars, data.matrices, o) : nearbyFromPoint(point, visibleBars, data.matrices, o)
  }, [data, finder, point, originBar, visibleBars, maxMinutes, finderTransit, onlyOpen, openMode, finderMinute])

  /** Finder: minutes and mode from the origin to a bar, as in the nearby list. */
  const reach = useCallback((target: Bar) => {
    if (!data || !point) return null
    const o = { transit: finderTransit, walkToleranceMinutes: FINDER_TOLERANCE }
    return originBar ? reachFromBar(originBar, target, data.matrices, o) : reachFromPoint(point, target, data.bars, data.matrices, o)
  }, [data, point, originBar, finderTransit])

  // Finder: the way from the origin to the selected bar.
  const finderRoute = useMemo(() => {
    if (!finder || !selected || !point || selected.id === point.barId) return null
    const r = reach(selected)
    if (!r) return null
    const key = `pt:${point.lat.toFixed(5)},${point.lon.toFixed(5)}>${selected.id}`
    return { ...r, from: point, to: selected, walkKey: key, transitKey: `${key}@${Math.round(finderMinute / 15) * 15}` }
  }, [finder, selected, point, reach, finderMinute])

  const focusStats = useMemo(() => {
    if (!data || focusDistrict === null) return null
    const f = data.districts.features.find((x) => Number(x.properties?.district) === focusDistrict)
    return districtStats(focusDistrict, (f?.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon) ?? null, data.bars,
      finder ? finderMinute : plan.weekday * DAY + plan.startMinutes)
  }, [data, focusDistrict, finder, finderMinute, plan])

  // Swapping or filling a slot: bars of its district, ranked by fit between its neighbours.
  const swap = useMemo(() => {
    if (!data || swapIndex === null || swapIndex >= slots.length) return null
    return { index: swapIndex, options: slotOptions(slots, swapIndex, visibleBars, data.matrices, listOptions) }
  }, [data, swapIndex, slots, visibleBars, listOptions])
  const swapSlot = swap ? slots[swap.index] : null

  const proposalTimelines = useMemo(() => proposals?.tours ?? [], [proposals])
  const previewTl: TimelineStop[] | null = proposals && proposalTimelines.length
    ? proposalTimelines[Math.min(activeProposal, proposalTimelines.length - 1)] : null
  const mapTl = previewTl ?? tl

  // The Atlas data is only fetched once the Atlas is opened.
  const [atlasData, setAtlasData] = useState<AtlasData | null>(null)
  useEffect(() => {
    if (atlas && !atlasData) loadAtlas().then((d) => d && setAtlasData(d))
  }, [atlas, atlasData])
  const [sizeBy, setSizeByState] = useState<SizeBy>(() => loadJson<SizeBy>('sizeBy', 'none'))
  const setSizeBy = (s: SizeBy) => {
    setSizeByState(s)
    saveJson('sizeBy', s)
  }
  const similarOf = (bar: Bar) => (bar.profile?.similar ?? []).map((i) => byIndex.get(i)).filter((b): b is Bar => !!b)

  const mapBars: MapBar[] = useMemo(() => {
    if (!data) return []
    // Finder: bars in reach stand out in their type colours, unnumbered; with an origin, the rest fade.
    const ranked = finder ? nearby.map((r) => r.bar) : swap ? swap.options.map((o) => o.bar) : refinedRecs.map((r) => r.bar)
    const rank = new Map(ranked.map((b, i) => [b.id, i]))
    const minutes = new Map(finder ? nearby.map((r) => [r.bar.id, r.minutes]) : [])
    const stopIndex = new Map<string, number>(finder ? [] : previewTl ? previewTl.map((s, i) => [s.bar.id, i])
      : slots.flatMap((s, i) => (s.bar ? [[s.bar.id, i] as const] : [])))
    const closed = new Set(mapTl.filter((s) => s.closedOnArrival).map((s) => s.bar.id))
    const focusId = swapSlot?.bar?.id ?? selected?.id
    const out: MapBar[] = []
    for (const bar of data.bars) {
      const si = stopIndex.get(bar.id)
      const r = rank.get(bar.id)
      const inSwapDistrict = !!swapSlot && bar.district === swapSlot.district
      const isOrigin = finder && bar.id === point?.barId
      if (si === undefined && bar.id !== focusId && r === undefined && !isOrigin && !matchesFilter(bar, shownFilter)) continue
      const m = mineSet.has(bar.id)
      if (bar.id === focusId) {
        out.push({ bar, role: 'selected', label: si !== undefined ? si + 1 : undefined, mine: m })
      } else if (si !== undefined) {
        out.push({ bar, role: 'stop', label: si + 1, closed: closed.has(bar.id), mine: m })
      } else if (r !== undefined || isOrigin) {
        // The tour numbers its top 5 like the list; the finder only marks what is in reach.
        const top = !finder && r! < 5
        out.push({ bar, role: top ? 'top' : 'next', label: top ? r! + 1 : undefined, mine: m, minutes: minutes.get(bar.id) })
      } else {
        // Fade bars you can't pick next, and districts outside the plan.
        const blocked = finder ? !!point : swapSlot ? !inSwapDistrict : !included.has(bar.district) || (!!selected
          && (bar.district === selected.district || stops.some((s) => s.district === bar.district)))
        out.push({ bar, role: 'other', dim: blocked, mine: m })
      }
    }
    return out
  }, [data, finder, nearby, point, refinedRecs, swap, swapSlot, mapTl, previewTl, slots, selected, stops, shownFilter, included, mineSet])

  const highlighted = highlightId ? byId.get(highlightId) ?? null : null
  // The bar a highlighted recommendation or swap option is reached from; the finder previews from its origin.
  const previewFrom = finder ? null : swap ? slots.slice(0, swap.index).reverse().find((s) => s.bar)?.bar ?? null : selected

  // Legs we want real paths for: the tour itself and the previewed leg. Proposal previews stay schematic.
  const wanted = useMemo(() => {
    const pairs: Pair[] = []
    if (!data) return pairs
    slotViews.forEach((v, i) => {
      const l = v.stop?.legIn
      if (l && l.mode !== 'unreachable' && !v.afterGap) {
        pairs.push({ a: slotViews[i - 1].stop!.bar, b: v.stop!.bar, mode: l.mode, departure: slotViews[i - 1].stop!.departure })
      }
    })
    if (previewFrom && highlighted) {
      const l = leg(data.matrices, previewFrom.matrixIndex, highlighted.matrixIndex, plan.walkToleranceMinutes)
      const departure = tl.find((s) => s.bar.id === previewFrom.id)?.departure ?? selectedTimes?.departure
      if (l.mode !== 'unreachable' && departure !== undefined) pairs.push({ a: previewFrom, b: highlighted, mode: l.mode, departure })
    }
    return pairs
  }, [data, slotViews, tl, previewFrom, highlighted, selectedTimes, plan.walkToleranceMinutes])

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

  // Fetch the real path for the finder route (cached like tour legs).
  useEffect(() => {
    if (!finderRoute) return
    const { from, to } = finderRoute
    if (finderRoute.mode === 'walk') {
      if (paths[finderRoute.walkKey]) return
      const key = finderRoute.walkKey
      walkingPath(from, to).then((coords) => { if (coords) setPaths((p) => ({ ...p, [key]: coords })) })
      return
    }
    const key = finderRoute.transitKey
    if (key in transit) {
      // No transit connection at all: show the walking path instead of a bare arc.
      if (transit[key] === null && !paths[finderRoute.walkKey]) {
        const wk = finderRoute.walkKey
        walkingPath(from, to).then((coords) => { if (coords) setPaths((p) => ({ ...p, [wk]: coords })) })
      }
      return
    }
    let cancelled = false
    ;(async () => {
      let route = await transitPath(from, to, finderMinute).catch(() => undefined)
      if (route === null && data) {
        // A point inside a block may not reach the street network; plan from the nearest bar
        // (bars sit on streets) and walk there first.
        let near: Bar | null = null
        let best = Infinity
        for (const b of data.bars) {
          const d = (b.lat - from.lat) ** 2 + ((b.lon - from.lon) * 0.67) ** 2
          if (d < best && b.id !== to.id) { best = d; near = b }
        }
        const viaBar = near ? await transitPath(near, to, finderMinute).catch(() => undefined) : null
        if (near && viaBar) {
          route = {
            ...viaBar,
            segments: [{ coords: [[from.lon, from.lat], [near.lon, near.lat]], kind: 'walk' }, ...viaBar.segments],
            parts: [{ mode: 'WALK', minutes: walkEstimate(from, near) }, ...viaBar.parts],
          }
        }
      }
      if (!cancelled && route !== undefined) setTransit((cur) => ({ ...cur, [key]: route }))
    })()
    return () => { cancelled = true }
  }, [finderRoute, paths, transit, finderMinute, data])

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

  // Tour legs; an empty slot is a hollow marker at its district centre with dashed lines to its neighbours.
  const { tourLegs, ghosts } = useMemo(() => {
    if (finder) {
      if (!finderRoute) return { tourLegs: [] as Leg[], ghosts: [] }
      const { from, to } = finderRoute
      if (finderRoute.mode === 'walk') {
        return { ghosts: [], tourLegs: [{ coords: paths[finderRoute.walkKey] ?? [[from.lon, from.lat], [to.lon, to.lat]], mode: 'walk' } as Leg] }
      }
      const route = transit[finderRoute.transitKey]
      if (route === null) {
        return { ghosts: [], tourLegs: [{ coords: paths[finderRoute.walkKey] ?? [[from.lon, from.lat], [to.lon, to.lat]], mode: 'walk' } as Leg] }
      }
      return {
        ghosts: [],
        tourLegs: route
          ? route.segments.map((sg) => ({ coords: sg.coords, mode: sg.kind === 'ride' ? 'ride' : 'transfer', color: sg.color, line: sg.line }) as Leg)
          : [{ coords: arc([from.lon, from.lat], [to.lon, to.lat]), mode: route === null ? 'transfer' : 'pending' } as Leg],
      }
    }
    if (previewTl) {
      return {
        ghosts: [],
        tourLegs: previewTl.slice(1).flatMap((s, i) => s.legIn && s.legIn.mode !== 'unreachable'
          ? drawLeg(previewTl[i].bar, s.bar, s.legIn.mode, previewTl[i].departure, false) : []),
      }
    }
    const point = (v: (typeof slotViews)[number]): [number, number] | null => {
      if (v.stop) return [v.stop.bar.lon, v.stop.bar.lat]
      const c = districtInfo.get(v.district)
      return c ? [c.lon, c.lat] : null
    }
    const legs: Leg[] = []
    slotViews.forEach((v, i) => {
      if (i === 0) return
      const prev = slotViews[i - 1]
      if (v.stop && prev.stop) {
        const l = v.stop.legIn
        if (l && l.mode !== 'unreachable') legs.push(...drawLeg(prev.stop.bar, v.stop.bar, l.mode, prev.stop.departure, true))
        return
      }
      const a = point(prev)
      const b = point(v)
      if (a && b) legs.push({ coords: [a, b], mode: 'gap' })
    })
    const gh = slotViews.flatMap((v, i) => {
      const c = !v.stop ? districtInfo.get(v.district) : null
      return c ? [{ lon: c.lon, lat: c.lat, label: i + 1 }] : []
    })
    return { tourLegs: legs, ghosts: gh }
  }, [finder, finderRoute, paths, transit, previewTl, slotViews, districtInfo, drawLeg])

  // Finder: travel time on the middle of the drawn route.
  const routeLabel = useMemo(() => {
    if (!finderRoute) return null
    const coords = tourLegs.flatMap((l) => l.coords)
    if (coords.length < 2) return null
    const [lon, lat] = coords[Math.floor(coords.length / 2)]
    return { lon, lat, text: `${finderRoute.minutes} min · ${finderRoute.mode === 'walk' ? 'zu Fuß' : 'Öffis'}` }
  }, [finderRoute, tourLegs])

  const preview: Leg[] = useMemo(() => {
    if (finder && point && highlighted && highlighted.id !== selected?.id) {
      return [{ coords: [[point.lon, point.lat], [highlighted.lon, highlighted.lat]], mode: 'gap' }]
    }
    if (!data || !previewFrom || !highlighted) return []
    const l = leg(data.matrices, previewFrom.matrixIndex, highlighted.matrixIndex, plan.walkToleranceMinutes)
    if (l.mode === 'unreachable') return []
    const departure = tl.find((s) => s.bar.id === previewFrom.id)?.departure ?? selectedTimes?.departure ?? null
    return drawLeg(previewFrom, highlighted, l.mode, departure, true)
  }, [finder, selected, point, data, previewFrom, highlighted, tl, selectedTimes, plan.walkToleranceMinutes, drawLeg])

  const slotRoutes = useMemo(() => slotViews.map((v, i) => i > 0 && !v.afterGap && v.stop?.legIn?.mode === 'transit'
    ? transit[transitKey(slotViews[i - 1].stop!.bar, v.stop.bar, slotViews[i - 1].stop!.departure)] : undefined), [slotViews, transit])
  // Remember each leg out of a stop that rides back the way the leg into it came.
  useEffect(() => {
    const found: [string, string][] = []
    slotViews.forEach((v, i) => {
      const next = slotViews[i + 1]
      if (v.stop && next?.stop && ridesBack(slotRoutes[i], slotRoutes[i + 1])) found.push([v.stop.bar.id, next.stop.bar.id])
    })
    if (!found.length) return
    setAvoidLegs((cur) => {
      const have = new Set(cur.map(([a, b]) => `${a}>${b}`))
      const add = found.filter(([a, b]) => !have.has(`${a}>${b}`))
      return add.length ? [...cur, ...add] : cur
    })
  }, [slotViews, slotRoutes])

  const visited = useMemo(() => new Set(finder ? [] : previewTl ? previewTl.map((s) => s.bar.district) : slots.map((s) => s.district)),
    [finder, previewTl, slots])
  const recLines = useMemo(
    () => selected && !swap && !finder ? refinedRecs.slice(0, 5).filter((r) => r.bar.id !== highlightId)
      .map((r) => [[selected.lon, selected.lat], [r.bar.lon, r.bar.lat]] as [number, number][]) : [],
    [selected, swap, finder, refinedRecs, highlightId],
  )

  function pick(id: string, fly: boolean) {
    const b = byId.get(id)
    // While swapping, a click on a bar of that slot's district takes it.
    if (swap && swapSlot && b && b.district === swapSlot.district && b.id !== swapSlot.bar?.id) {
      setSlotBar(swap.index, b.id)
      return
    }
    // Placing the marker on a bar (click or search) searches from that bar, with its travel times.
    if (finder && placing && b) {
      setOrigin({ lat: b.lat, lon: b.lon, label: b.name, barId: b.id })
      return
    }
    // Otherwise picking a bar only shows it (and the way there, if a point is set).
    setSelectedId(id)
    setHighlightId(null)
    setSwapIndex(null)
    if (fly && b) setFocus({ lat: b.lat, lon: b.lon, key: Date.now() })
  }

  function clearSelection() {
    setSelectedId(null)
    setHighlightId(null)
    setSwapIndex(null)
  }

  /** Escape or a click on empty map: one step back. In the finder: the bar, then the origin. */
  function back() {
    if (finder && placing) setPlacing(false)
    else if (finder && selectedId && selectedId !== point?.barId) clearSelection()
    else if (finder && point) clearOrigin()
    else clearSelection()
  }

  function clearOrigin() {
    setPoint(null)
    clearSelection()
  }

  function setMode(m: AppMode) {
    setModeState(m)
    saveJson('mode', m)
    clearSelection()
    setPlacing(false)
  }

  function setOrigin(p: Origin) {
    setPoint(p)
    setPlacing(false)
    setLocateError(null)
    clearSelection()
  }

  function locate() {
    if (!navigator.geolocation) {
      setLocateError('Euer Browser kann keinen Standort liefern. Setzt stattdessen einen Punkt auf der Karte.')
      return
    }
    setLocating(true)
    setLocateError(null)
    navigator.geolocation.getCurrentPosition((pos) => {
      setLocating(false)
      const p = { lat: pos.coords.latitude, lon: pos.coords.longitude, label: 'Euer Standort', gps: true }
      if (p.lat < 48.1 || p.lat > 48.34 || p.lon < 16.15 || p.lon > 16.6) {
        setLocateError('Ihr seid gerade nicht in Wien. Setzt stattdessen einen Punkt auf der Karte.')
        return
      }
      setOrigin(p)
      setFocus({ lat: p.lat, lon: p.lon, key: Date.now() })
    }, () => {
      setLocating(false)
      setLocateError('Standort nicht verfügbar oder nicht erlaubt. Setzt stattdessen einen Punkt auf der Karte.')
    }, { enableHighAccuracy: true, timeout: 10_000 })
  }

  /** A random pick among the nearest, favouring tipped and tagged places. */
  function surprise() {
    const pool = nearby.slice(0, 20)
    if (!pool.length) return
    const w = pool.map((r) => 1 + 2 * strongTips(r.bar).length + 0.3 * r.bar.tags.length + (r.open ? 0.5 : 0))
    let x = Math.random() * w.reduce((a, b) => a + b, 0)
    const hit = pool.find((_, i) => (x -= w[i]) <= 0) ?? pool[0]
    setHighlightId(hit.bar.id)
    setFocus({ lat: hit.bar.lat, lon: hit.bar.lon, key: Date.now() })
  }

  function toggleMine(id: string) {
    setMine((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))
  }

  function closeIncoming(accept: boolean) {
    if (accept && incoming) setMine((cur) => [...cur, ...incoming.filter((id) => !cur.includes(id) && byId.has(id))])
    setIncoming(null)
    history.replaceState(null, '', location.pathname + location.search)
  }

  const toSlots = useCallback((r: TourResult): SlotIds[] => r.stops.flatMap((id) => {
    const b = byId.get(id)
    return b ? [{ district: b.district, barId: b.id }] : []
  }), [byId])

  function propose(from: Bar | null) {
    if (!channels) return
    setPlanOpen(false)
    setActiveProposal(0)
    setProposals({ title: from ? `Touren ab ${from.name}` : 'Tourvorschläge', running: true, progress: 0, tours: [] })
    setSelectedId(null)
    const options: SolveRequest = { ...solveBase, startDistrict: from ? null : plan.startDistrict, prefix: from ? [from.id] : [], pinned: [] }
    channels.plan.run({ type: 'propose', options, count: 3 }, {
      onProgress: (done, total) => setProposals((p) => p && { ...p, progress: done / total }),
    }).then((tours) => {
      setProposals((p) => p && {
        ...p, running: false, progress: 1,
        tours: tours.map((t) => makeTimeline(t.stops.map((id) => byId.get(id)).filter((b): b is Bar => !!b))),
      })
    }, (e) => { if (!(e instanceof CancelledError)) setProposals((p) => p && { ...p, running: false }) })
  }

  function applyProposal(i: number) {
    const t = proposalTimelines[i]
    if (!t) return
    setSlotIds(t.map((s) => ({ district: s.bar.district, barId: s.bar.id })))
    setPinned((cur) => new Set(t.filter((s) => cur.has(s.bar.id)).map((s) => s.bar.id)))
    setProposals(null)
    channels?.plan.cancel()
  }

  /** One open place per planned district, in a walkable order of district centres. */
  function makeTemplate() {
    const left = new Set(plan.districts)
    const end = plan.endDistrict
    if (end !== null) left.delete(end)
    const centre = (d: number) => districtInfo.get(d) ?? { lon: 16.37, lat: 48.21 }
    let cur = plan.startDistrict ?? [...left].sort((a, b) => a - b)[0]
    const order: number[] = []
    while (cur !== undefined && left.size) {
      order.push(cur)
      left.delete(cur)
      const c = centre(cur)
      cur = [...left].sort((a, b) => {
        const da = (centre(a).lon - c.lon) ** 2 * 0.44 + (centre(a).lat - c.lat) ** 2
        const db = (centre(b).lon - c.lon) ** 2 * 0.44 + (centre(b).lat - c.lat) ** 2
        return da - db
      })[0]
    }
    if (end !== null) order.push(end)
    setSlotIds(order.map((d) => ({ district: d, barId: null })))
    setPinned(new Set())
    setPlanOpen(false)
    setSelectedId(null)
  }

  function runPlanJob(label: string, job: Parameters<SolverChannel['run']>[0]) {
    if (!channels) return
    setBusy(label)
    setSwapIndex(null)
    channels.plan.run(job).then((tours) => {
      setBusy(null)
      if (tours[0]) setSlotIds(toSlots(tours[0]))
    }, (e) => { if (!(e instanceof CancelledError)) setBusy(null) })
  }

  /** Keep the slots in their order, fill open ones, add missing districts after them. */
  function finishTour() {
    runPlanJob('Plane die offenen Bezirke …', { type: 'complete', options: { ...solveBase, prefix: [], pinned: [] }, slots: slotIds })
  }

  /** Keep pinned bars (a pinned first stop stays the start), choose everything else anew. */
  /** The tour as Excel (one row per stop) or GPX (waypoints, route, and the paths as a track). */
  function exportTour(kind: 'xlsx' | 'gpx') {
    const day = WEEKDAYS[plan.weekday]
    const stamp = `${day.toLowerCase()}-${clock(plan.startMinutes).replace(':', '')}`
    const name = `Seidl-Tour · ${day} ab ${clock(plan.startMinutes)}`
    if (kind === 'xlsx') {
      const table = tourTable(slotViews, slotRoutes.map((r) => r?.lines))
      download(xlsx(table, 'Seidl-Tour', name), `seidl-tour-${stamp}.xlsx`,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      return
    }
    // The way into each stop: the real walking path or transit route where loaded, else straight.
    const ways = slotViews.map((v, i) => {
      const prev = slotViews.slice(0, i).reverse().find((x) => x.stop)?.stop
      if (!v.stop?.legIn || !prev || v.afterGap) return null
      if (v.stop.legIn.mode === 'walk') return paths[walkKey(prev.bar, v.stop.bar)] ?? null
      return slotRoutes[i]?.segments.flatMap((sg) => sg.coords) ?? null
    })
    download(tourGpx(slotViews, ways, name), `seidl-tour-${stamp}.gpx`, 'application/gpx+xml')
  }

  function optimizeTour() {
    const first = slotIds[0]?.barId && pinned.has(slotIds[0].barId) ? [slotIds[0].barId] : []
    const keep = stopIds.filter((id) => pinned.has(id) && id !== first[0])
    const districts = [...new Set([...plan.districts, ...stops.filter((b) => pinned.has(b.id)).map((b) => b.district)])]
    runPlanJob('Optimiere die Tour …', { type: 'solve', options: { ...solveBase, districts, prefix: first, pinned: keep } })
  }

  function setSlotBar(index: number, id: string) {
    setSlotIds((cur) => cur.map((s, i) => (i === index ? { ...s, barId: id } : s)))
    setPinned((cur) => new Set([...cur, id]))
    setSwapIndex(null)
    setHighlightId(null)
  }

  function addSelected() {
    if (!selected) return
    const i = slotIds.findIndex((s) => s.district === selected.district)
    if (i >= 0) setSlotBar(i, selected.id)
    else {
      setSlotIds((cur) => [...cur, { district: selected.district, barId: selected.id }])
      setPinned((cur) => new Set([...cur, selected.id]))
    }
  }

  function moveSlot(from: number, to: number) {
    setSlotIds((cur) => {
      const next = cur.slice()
      const [x] = next.splice(from, 1)
      next.splice(to, 0, x)
      return next
    })
    setSwapIndex(null)
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

  // Escape steps back like a click on empty map: selection or swap, then the finder's origin.
  const escRef = useRef(back)
  useEffect(() => { escRef.current = back })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || tasteOpen || planOpen) return
      escRef.current()
      setFocusDistrict(null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [tasteOpen, planOpen])

  // Phone: the sheet makes room for the map while placing a point, and opens for what you pick.
  useEffect(() => { if (placing) setSnap('peek') }, [placing])
  useEffect(() => { setSnap((s) => (s === 'peek' ? 'half' : s)) }, [finder, point, selectedId, proposals])
  useEffect(() => setStatsOpen(false), [focusDistrict])

  if (error) return <main className="loading">Daten konnten nicht geladen werden: {error}</main>
  if (!data) return <main className="loading"><span className="spinner" /> Lade Lokale und Fahrzeiten …</main>

  const blockedBy = selected && !stopIds.includes(selected.id) ? stops.find((b) => b.district === selected.district) ?? null : null
  const emptySlot = !!selected && slotIds.some((s) => s.district === selected.district && !s.barId)
  const hovered = hoverBar ? byId.get(hoverBar.id) : null
  const hoverFrom = previewFrom
  const hoverLeg = hovered && hoverFrom && hovered.id !== hoverFrom.id
    ? leg(data.matrices, hoverFrom.matrixIndex, hovered.matrixIndex, plan.walkToleranceMinutes) : null
  const hoverDeparture = finder ? finderMinute : hoverFrom ? tl.find((s) => s.bar.id === hoverFrom.id)?.departure ?? selectedTimes?.departure ?? null : null
  const hoverArrival = hoverLeg && hoverDeparture !== null && hoverLeg.mode !== 'unreachable' ? hoverDeparture + hoverLeg.minutes : null
  // In swap mode: what taking the hovered bar would change.
  const hoverSwap = swap && swapSlot && hovered && hovered.district === swapSlot.district && hovered.id !== swapSlot.bar?.id
    ? slotDelta(slots, swap.index, hovered, data.matrices, listOptions) : null
  const hd = hoverDistrict && !hoverBar && hoverDistrict.district !== focusDistrict ? districtInfo.get(hoverDistrict.district) : null
  // Finder: the way from the origin, as in the list.
  const hoverReach = finder && point && hovered && hovered.id !== point.barId ? reach(hovered) : null
  // Nothing picked, planned or opened: no panel; on a phone the map gets the whole screen.
  const panelEmpty = !selected && !(phone && statsOpen) && (atlas || (finder ? !point : !proposals && slotIds.length === 0))
  const finderLabel = finderTime === null ? 'jetzt' : `${WEEKDAYS[Math.floor(finderTime / DAY) % 7].slice(0, 2)} ${clock(finderTime)}`
  const districtCard = focusStats && focusDistrict !== null ? (
    <DistrictCard name={districtName(focusDistrict)} stats={focusStats}
      atLabel={finder ? finderLabel : `${WEEKDAYS[plan.weekday].slice(0, 2)} ${clock(plan.startMinutes)}`}
      onPick={(id) => pick(id, true)} onClose={() => (phone ? setStatsOpen(false) : setFocusDistrict(null))} />
  ) : null
  const finderDay = Math.floor(finderMinute / DAY) % 7
  const openModes = (
    <div className="open-modes" role="group" aria-label="Öffnungszeiten">
      <button type="button" aria-pressed={openMode === 'all'} onClick={() => setOpenMode('all')}
        title="Alle Lokale, auch geschlossene">Alle</button>
      <button type="button" aria-pressed={openMode === 'open'} onClick={() => setOpenMode('open')}
        title="Offen oder ohne bekannte Öffnungszeiten (etwa ein Drittel aller Lokale)">Offen + ohne Zeiten</button>
      <button type="button" aria-pressed={openMode === 'sure'} onClick={() => setOpenMode('sure')}
        title="Nur Lokale, die laut Öffnungszeiten offen haben">Sicher offen</button>
    </div>
  )
  const myBars = (
    <MyBars bars={mineBars} onlyMine={onlyMine} onOnlyMine={setOnlyMine} onPick={(id) => pick(id, true)}
      onRemove={(id) => setMine((cur) => cur.filter((x) => x !== id))} />
  )
  const planSummary = `${WEEKDAYS[plan.weekday].slice(0, 2)} ${clock(plan.startMinutes)} · ${plan.districts.length} Bezirke`

  return (
    <div className="app">
      <header className="topbar">
        <FilterMenu bars={data.bars} filter={baseFilter} onFilter={setFilter} planMinuteOfWeek={plan.weekday * DAY + plan.startMinutes}
          onPick={(id) => pick(id, true)} mode={mode} onMode={setMode} showOpenFilter={!finder && !atlas}
          actions={<>
            {myBars}
            {atlas ? null : finder ? (<>
              <details className="popover">
                <summary><Icon name="clock" size={14} /> {finderTime === null ? `Jetzt · ${WEEKDAYS[finderDay].slice(0, 2)} ${clock(now)}` : finderLabel}</summary>
                <div className="popover-body">
                  <label className="check">
                    <input type="radio" name="finder-time" checked={finderTime === null} onChange={() => setFinderTime(null)} /> Jetzt
                  </label>
                  <label className="check">
                    <input type="radio" name="finder-time" checked={finderTime !== null} onChange={() => setFinderTime(Math.ceil(now / 15) * 15)} /> Anderer Zeitpunkt
                  </label>
                  {finderTime !== null && (
                    <div className="inline-fields">
                      <select aria-label="Wochentag" value={finderDay}
                        onChange={(e) => setFinderTime(Number(e.target.value) * DAY + (finderTime % DAY))}>
                        {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
                      </select>
                      <input type="time" aria-label="Uhrzeit" step={900} min="00:00" value={clock(finderTime)}
                        onChange={(e) => {
                          const [h, mi] = e.target.value.split(':').map(Number)
                          if (!Number.isNaN(h)) setFinderTime(finderDay * DAY + h * 60 + (mi || 0))
                        }} />
                    </div>
                  )}
                  {phone && openModes}
                </div>
              </details>
              {!phone && openModes}
            </>) : (<>
              <span className="plan-summary">{planSummary}</span>
              <button type="button" className="accent-btn" onClick={() => setPlanOpen(true)}><Icon name="route" size={15} /> Tour planen</button>
            </>)}
          </>} />
      </header>
      <main className="planner">
        <div className={atlas ? 'map-wrap atlas-on' : 'map-wrap'}>
          <MapView bars={mapBars} districts={data.districts} districtLabels={data.districtLabels} viennaMask={data.viennaMask} visitedDistricts={visited}
            tourLegs={tourLegs} recLines={recLines} preview={preview} ghosts={ghosts} highlightId={highlightId} focus={focus}
            focusDistrict={focusDistrict} onSelect={(id) => pick(id, false)}
            origin={finder ? point : null} routeLabel={routeLabel}
            inset={phone ? { right: 0, bottom: sheetHeight } : { right: PANEL_INSET, bottom: 0 }}
            sizeBy={sizeBy}
            reach={finder && point ? { key: `${point.lat},${point.lon},${finderTransit}`, minutes: maxMinutes } : null}
            onContextPoint={finder ? (at) => setOrigin({ ...at, label: 'Gewählter Punkt' }) : undefined}
            onBackgroundClick={(d, at) => {
              if (finder && placing) {
                setOrigin({ ...at, label: 'Gewählter Punkt' })
                return
              }
              // The finder steps back: the bar, then the origin.
              if (finder && (selectedId || point)) {
                back()
                return
              }
              // An empty spot clears the selection; inside a district it also focuses it (again: unfocus).
              const hadSelection = !!selectedId || swapIndex !== null
              clearSelection()
              if (!hadSelection) setFocusDistrict((cur) => (d === null || cur === d ? null : d))
            }}
            onHoverBar={setHoverBar} onHoverDistrict={setHoverDistrict} />
          {hovered && hoverBar && !phone && (
            <div className="hover-card" style={{ left: hoverBar.x + 16, top: hoverBar.y + 12 }}>
              <strong>{hovered.name}</strong> <TipBadge bar={hovered} />
              <div className="rec-meta"><TypePill bar={hovered} /> <span>{hovered.district}. Bezirk</span></div>
              {hoverSwap ? (
                <div className="hover-leg">
                  {swapSlot?.bar ? `Statt ${swapSlot.bar.name}: ` : 'Für den offenen Platz: '}
                  <span className={hoverSwap.travelDelta <= 0 && swapSlot?.bar ? 'good' : ''}>
                    {hoverSwap.travelDelta >= 0 ? '+' : '−'}{Math.abs(Math.round(hoverSwap.travelDelta))} Min. Weg
                  </span>
                  <span className="muted small"> · Klick übernimmt</span>
                </div>
              ) : hoverReach ? (
                <div className="hover-leg">
                  <ModeIcon mode={hoverReach.mode} /> {hoverReach.mode === 'walk' ? 'ca. ' : ''}{hoverReach.minutes} Min.{' '}
                  {hoverReach.mode === 'walk' ? 'zu Fuß' : 'mit Öffis'} von {point?.label}
                </div>
              ) : hoverLeg && (
                <div className="hover-leg"><ModeIcon mode={hoverLeg.mode} /> {legLabel(hoverLeg)} von {hoverFrom?.name}</div>
              )}
              <div className="chips"><TagChips bar={hovered} max={4} /> <OpenStatus bar={hovered} at={hoverReach ? finderMinute + hoverReach.minutes : hoverArrival} /></div>
            </div>
          )}
          {hd && hoverDistrict && (
            <div className="district-tip" style={{ left: hoverDistrict.x + 14, top: hoverDistrict.y + 14 }}>
              <strong>{hoverDistrict.district}. {hd.name}</strong>
              <span>{hd.count} Lokale{visited.has(hoverDistrict.district) ? ' · in der Tour' : ''}
                {!included.has(hoverDistrict.district) ? ' · nicht in der Planung' : ''}</span>
            </div>
          )}
          {focusDistrict !== null && (
            <div className="district-focus" role="status">
              <strong>{districtName(focusDistrict)}</strong>
              <span>{districtInfo.get(focusDistrict)?.count ?? 0} Lokale{visited.has(focusDistrict) ? ' · in der Tour' : ''}</span>
              {phone && (
                <button type="button" className="stats-btn" aria-pressed={statsOpen}
                  onClick={() => { setStatsOpen((v) => !v); setSnap('half') }}>
                  <Icon name="chart" size={14} /> Statistik
                </button>
              )}
              <button type="button" className="icon-btn" aria-label="Bezirksfokus beenden" onClick={() => setFocusDistrict(null)}><Icon name="x" size={16} /></button>
            </div>
          )}
          {!phone && !atlas && districtCard}
          {atlas && (
            <Atlas data={atlasData} bars={visibleBars} byIndex={byIndex} selectedId={selectedId} highlightId={highlightId} mine={mineSet}
              inset={phone ? { right: 0, bottom: sheetHeight } : { right: PANEL_INSET, bottom: 0 }}
              onSelect={(id) => pick(id, false)} onBackground={clearSelection} />
          )}
          {finder && (
            <MapButtons locating={locating} located={!!point?.gps} placing={placing}
              onLocate={locate} onPlace={() => setPlacing((v) => !v)}
              style={phone ? { right: 12, bottom: sheetHeight + 12, visibility: snap === 'full' && !panelEmpty ? 'hidden' : undefined } : { right: 16, bottom: 16 }} />
          )}
          {finder && placing ? (
            <MapToast onClose={() => setPlacing(false)}>
              {phone ? 'Tippt auf die Karte oder ein Lokal, um den Punkt zu setzen.' : 'Klickt auf die Karte oder ein Lokal, um den Punkt zu setzen.'}
            </MapToast>
          ) : finder && locateError ? (
            <MapToast warn onClose={() => setLocateError(null)}>{locateError}</MapToast>
          ) : null}
          {incoming && (
            <MineImport count={incoming.filter((id) => byId.has(id)).length} known={incoming.filter((id) => mineSet.has(id)).length}
              onAccept={() => closeIncoming(true)} onDismiss={() => closeIncoming(false)} />
          )}
          {!atlas && <div className="map-legend" aria-label="Legende">
            <div>
              {VENUE_TYPES.map((t) => <span key={t}><i className="type-dot" style={{ background: TYPE_COLOR[t] }} /> {TYPE_SHORT[t]}</span>)}
            </div>
            <div className="size-row">
              <span className="muted">Größe</span>
              <div className="segmented small" role="group" aria-label="Punktgröße">
                {([['none', 'gleich'], ['popularity', 'Beliebtheit'], ['satisfaction', 'Zufriedenheit']] as const).map(([k, label]) => (
                  <button key={k} type="button" aria-pressed={sizeBy === k} onClick={() => setSizeBy(k)}>{label}</button>
                ))}
              </div>
            </div>
            {sizeBy !== 'none' && (
              <div className="size-key">
                {SIZE_STEPS[sizeBy].map((s, i) => (
                  <span key={s.min}><i style={{ width: 6 * SIZE_FACTORS[i] * 1.6, height: 6 * SIZE_FACTORS[i] * 1.6 }} className={i === 3 ? 'top' : undefined} /> {s.label}</span>
                ))}
              </div>
            )}
            {finder && point && (
              <div>
                <span><i className="reach-dot in" /> in {maxMinutes} Min. erreichbar ({nearby.length})</span>
                <span><i className="reach-dot out" /> zu weit</span>
              </div>
            )}
            {!finder && <div>
              <span><i className="lg walk" /> zu Fuß</span>
              <span><i className="lg ride" /> Öffi-Linie</span>
              <span><i className="lg pending" /> Öffis, lädt</span>
              <span><i className="lg gap" /> offener Bezirk</span>
            </div>}
          </div>}
        </div>
        <Panel phone={phone} empty={panelEmpty} withFabs={finder} snap={snap} onSnap={setSnap} onHeight={setSheetHeight}>
          {phone && statsOpen ? districtCard : atlas ? (
            selected && (
              <BarPanel bar={selected} arrival={null} blockedBy={null} inTour={false}
                newestEdition={data.manifest.newestOfficialEdition} tourEmpty={false} busy={false} emptySlot={false}
                onAdd={() => {}} onReplace={() => {}} onPropose={() => {}}
                mine={mineSet.has(selected.id)} onMine={() => toggleMine(selected.id)} finder={{}}
                similar={similarOf(selected)} onPickSimilar={(id) => pick(id, false)} onHoverSimilar={setHighlightId}
                onClose={clearSelection} onTagChange={changeTag} />
            )
          ) : finder ? (
            <>
              {selected && (
                <BarPanel bar={selected} arrival={finderMinute + (finderRoute?.minutes ?? 0)} blockedBy={null} inTour={false}
                  newestEdition={data.manifest.newestOfficialEdition} tourEmpty={false} busy={false} emptySlot={false}
                  onAdd={() => {}} onReplace={() => {}} onPropose={() => {}}
                  mine={mineSet.has(selected.id)} onMine={() => toggleMine(selected.id)}
                  finder={{
                    route: finderRoute && point ? {
                      mode: finderRoute.mode,
                      text: `${finderRoute.mode === 'walk' ? 'ca. ' : ''}${finderRoute.minutes} Min. ${finderRoute.mode === 'walk' ? 'zu Fuß' : 'mit Öffis'} von ${point.label}`,
                      lines: transit[finderRoute.transitKey]?.lines ?? [],
                      href: googleMapsDirections(point, selected, finderRoute.mode === 'walk'
                        ? { mode: 'walk', minutes: finderRoute.minutes } : { mode: 'transit', minutes: finderRoute.minutes }),
                    } : undefined,
                  }}
                  similar={similarOf(selected)} onPickSimilar={(id) => pick(id, true)} onHoverSimilar={setHighlightId}
                  onClose={back} onTagChange={changeTag} />
              )}
              {point && (
                <NearbyList title={originBar ? `Von ${originBar.name} aus` : point.label} results={nearby} maxMinutes={maxMinutes}
                  transit={finderTransit} departure={onlyOpen ? finderMinute : null} highlightId={highlightId}
                  onMaxMinutes={setMaxMinutes} onTransit={setFinderTransit} onPick={(id) => pick(id, true)}
                  onHover={setHighlightId} onSurprise={surprise} onClear={clearOrigin} />
              )}
            </>
          ) : (<>
          {proposals && (
            <Proposals state={proposals} participants={preferences.participants} districtName={districtName}
              active={activeProposal} onHover={setActiveProposal} onApply={applyProposal}
              onClose={() => { setProposals(null); channels?.plan.cancel() }} />
          )}
          {selected && (
            <BarPanel bar={selected} arrival={selectedTimes?.arrival ?? null} blockedBy={blockedBy}
              inTour={!!selected && stopIds.includes(selected.id)} newestEdition={data.manifest.newestOfficialEdition}
              tourEmpty={slotIds.length === 0} busy={!!busy || !!proposals?.running} emptySlot={emptySlot}
              onAdd={addSelected}
              onReplace={() => selected && blockedBy && setSlotBar(slotIds.findIndex((s) => s.barId === blockedBy.id), selected.id)}
              onPropose={() => propose(selected)}
              mine={mineSet.has(selected.id)} onMine={() => toggleMine(selected.id)}
              similar={similarOf(selected)} onPickSimilar={(id) => pick(id, true)} onHoverSimilar={setHighlightId}
              onClose={clearSelection} onTagChange={changeTag} />
          )}
          {!selected && !proposals && slotIds.length > 0 && (
            <TourStats slots={slotViews} routes={slotRoutes} stopMinutes={plan.stopMinutes} />
          )}
          {selected && !swap && (
            <Recommendations recs={refinedRecs} preferences={preferences} departure={selectedTimes?.departure ?? null}
              refining={refining}
              onPreferences={(p) => setPrefs({ similarity: p.similarity, speedVsMatch: p.speedVsMatch })}
              onPreview={(id) => pick(id, true)} onHover={setHighlightId} />
          )}
          {slotIds.length > 0 && <TourPanel slots={slotViews} districtCount={plan.districts.length} districtName={districtName} pinned={pinned}
            onExport={exportTour}
            routes={slotRoutes} swap={swap} selectedId={selectedId} busy={busy}
            onSelect={(id) => pick(id, true)}
            onRemove={(i) => { setSlotIds((cur) => cur.filter((_, k) => k !== i)); setSwapIndex(null) }}
            onClear={(i) => { setSlotIds((cur) => cur.map((s, k) => (k === i ? { ...s, barId: null } : s))); setSwapIndex(null) }}
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
              const s = i !== null ? slots[i] : null
              const at = s?.bar ?? (s ? districtInfo.get(s.district) : null)
              if (at) setFocus({ lat: at.lat, lon: at.lon, key: Date.now() })
            }}
            onPickSwap={(id) => swap && setSlotBar(swap.index, id)}
            onHoverSwap={setHighlightId}
            onMove={moveSlot}
            onFinish={finishTour} onOptimize={optimizeTour}
            onClearAll={() => { setSlotIds([]); setPinned(new Set()); setSwapIndex(null) }} />}
          </>)}
          {/* On phones the credits sit at the end of the sheet; the map keeps the whole screen. */}
          {phone && <Footer />}
        </Panel>
      </main>
      {!phone && <Footer />}
      {planOpen && (
        <PlanDialog plan={plan} onPlan={setPlan} group={group} onGroup={setGroup} districtName={districtName} mineDistricts={mineDistricts.size}
          tourEmpty={slotIds.length === 0} busy={!!busy || !!proposals?.running}
          onTaste={() => setTasteOpen(true)} onPropose={() => propose(null)} onTemplate={makeTemplate}
          onClose={() => setPlanOpen(false)} />
      )}
      {tasteOpen && (
        <TasteFinder onClose={() => setTasteOpen(false)}
          onDone={(p) => { setGroup(p); setTasteOpen(false); setPrefs((cur) => ({ ...cur, speedVsMatch: Math.max(cur.speedVsMatch, 0.6) })) }} />
      )}
    </div>
  )
}
