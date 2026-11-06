import * as maplibregl from 'maplibre-gl'
import type { AllPaintProperties, ExpressionSpecification, GeoJSONSource, MapLayerMouseEvent } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
// MapLibre builds its worker URL at runtime, which Vite can't see, so the production build
// would lack the worker file and the map would never get its data. Bundle the worker
// explicitly and tell MapLibre where it is.
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'

maplibregl.setWorkerUrl(maplibreWorkerUrl)
import { useEffect, useLayoutEffect, useRef } from 'react'
import type { Bar } from '../domain/types'
import { MINE_COLOR, SELECT_COLOR, SELECT_HALO, TYPE_COLOR } from '../theme'

// A calm monochrome base map, so the bar colours carry the information.
const STYLE = 'https://tiles.openfreemap.org/styles/positron'
const FONT = ['Noto Sans Bold']

// Positron alone is too flat to read streets, parks and water, so lift its layers to muted but
// distinct tones: warm-grey land, white streets with grey casings, sage green, soft blue water.
const BASEMAP: Record<string, Partial<Record<keyof AllPaintProperties, string>>> = {
  background: { 'background-color': '#e2ddd3' },
  landuse_residential: { 'fill-color': '#dcd7cc' },
  park: { 'fill-color': '#bcd3a9' },
  landcover_wood: { 'fill-color': '#aec89b' },
  water: { 'fill-color': '#93b8cf' },
  waterway: { 'line-color': '#82abc4' },
  building: { 'fill-color': '#d1cabd', 'fill-outline-color': '#b8af9f' },
  highway_path: { 'line-color': '#faf9f6' },
  highway_minor: { 'line-color': '#ffffff' },
  highway_major_casing: { 'line-color': '#aaa194' },
  highway_major_inner: { 'line-color': '#ffffff' },
  highway_major_subtle: { 'line-color': '#b8b0a3' },
  highway_motorway_casing: { 'line-color': '#9d9483' },
  highway_motorway_bridge_casing: { 'line-color': '#9d9483' },
  tunnel_motorway_casing: { 'line-color': '#b5ad9f' },
  railway: { 'line-color': '#9a9387' },
  railway_transit: { 'line-color': '#a9a296' },
  railway_service: { 'line-color': '#a9a296' },
  'highway-name-minor': { 'text-color': '#5e5953' },
  'highway-name-major': { 'text-color': '#4a4641' },
}

export type Role = 'selected' | 'stop' | 'top' | 'next' | 'other'

export interface MapBar {
  bar: Bar
  role: Role
  /** Number on the marker: rank for recommendations, position for tour stops. */
  label?: number
  closed?: boolean
  /** Fade it: a bar is selected and this one isn't relevant to it. */
  dim?: boolean
  /** In "Meine Lokale": drawn with a heart. */
  mine?: boolean
  /** Finder: minutes from the origin, for the reveal wave. */
  minutes?: number
}

/** What the dot size shows: nothing, Beliebtheit or Zufriedenheit. */
export type SizeBy = 'none' | 'popularity' | 'satisfaction'

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export interface Leg {
  coords: [number, number][]
  /** walk: a walking leg; ride: on a vehicle; transfer: walking within a transit leg;
   *  pending: a transit leg whose route isn't known (yet), drawn as a dashed arc;
   *  gap: to or from an empty slot of the tour. */
  mode: 'walk' | 'ride' | 'transfer' | 'pending' | 'gap'
  color?: string
  line?: string
}

export interface HoverInfo {
  id: string
  x: number
  y: number
}

interface Props {
  bars: MapBar[]
  districts: GeoJSON.FeatureCollection
  districtLabels: GeoJSON.FeatureCollection
  viennaMask: GeoJSON.FeatureCollection
  visitedDistricts: Set<number>
  tourLegs: Leg[]
  recLines: [number, number][][]
  preview: Leg[]
  /** Empty tour slots, drawn as hollow numbered markers at the district centre. */
  ghosts: { lon: number; lat: number; label: number }[]
  highlightId: string | null
  focus: { lat: number; lon: number; key: number } | null
  onSelect: (id: string) => void
  /** A click on the map that hits no bar; with the district under it, if any, and the point. */
  onBackgroundClick: (district: number | null, at: { lat: number; lon: number }) => void
  /** Right-click: a point picked on the map. */
  onContextPoint?: (at: { lat: number; lon: number }) => void
  /** Finder: the free point bars are searched from (home, GPS, click). */
  origin: { lat: number; lon: number } | null
  /** Finder: the travel time, shown as a pill on the drawn route. */
  routeLabel?: { lon: number; lat: number; text: string } | null
  /** District picked by a click on empty map: emphasised and zoomed to. */
  focusDistrict: number | null
  onHoverBar: (h: HoverInfo | null) => void
  onHoverDistrict: (h: { district: number; x: number; y: number } | null) => void
  /** Pixels covered by the panel (desktop: right) or the bottom sheet (phone), kept clear when moving the map. */
  inset: { right: number; bottom: number }
  sizeBy: SizeBy
  /** Finder: what is in reach; a change replays the reveal wave. key = origin and travel mode. */
  reach?: { key: string; minutes: number } | null
}

/** Four size steps per score, the same as the labels in the panel; a smooth scale made 80 and
 *  100 look alike. Unknown scores get the smallest step. */
export const SIZE_STEPS: Record<Exclude<SizeBy, 'none'>, { min: number; label: string }[]> = {
  popularity: [{ min: 0, label: 'kaum bekannt' }, { min: 40, label: 'bekannt' }, { min: 70, label: 'sehr bekannt' }, { min: 90, label: 'Publikumsmagnet' }],
  satisfaction: [{ min: 0, label: 'gemischt' }, { min: 50, label: 'zufrieden' }, { min: 70, label: 'sehr zufrieden' }, { min: 85, label: 'begeistert' }],
}
export const SIZE_FACTORS = [0.55, 1, 1.6, 2.3]

function scoreKey(sizeBy: Exclude<SizeBy, 'none'>) {
  return sizeBy === 'popularity' ? 'pop' : 'sat'
}

function sizeFactor(sizeBy: SizeBy): ExpressionSpecification | number {
  if (sizeBy === 'none') return 1
  const steps = SIZE_STEPS[sizeBy]
  return ['step', ['get', scoreKey(sizeBy)], SIZE_FACTORS[0],
    steps[1].min, SIZE_FACTORS[1], steps[2].min, SIZE_FACTORS[2], steps[3].min, SIZE_FACTORS[3]] as ExpressionSpecification
}

/** Dot radius by zoom, times the size factor, and bigger while hovered. */
function radius(z11: number, z15: number, sizeBy: SizeBy): ExpressionSpecification {
  const f = sizeFactor(sizeBy)
  const hover: ExpressionSpecification = ['case', ['boolean', ['feature-state', 'hover'], false], 1.6, 1]
  return ['interpolate', ['linear'], ['zoom'], 11, ['*', z11, f, hover], 15, ['*', z15, f, hover]]
}

/** How long the mouse must stay in a district before the others are greyed out. */
const HOVER_DWELL_MS = 1300

const BAR_LAYERS = ['bars-other', 'bars-next', 'bars-top', 'bars-stop', 'bars-selected', 'bars-mine']
const empty: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }
const typeColor = ['match', ['get', 'type'], ...Object.entries(TYPE_COLOR).flat(), '#888888'] as unknown as string

function barsGeoJson(bars: MapBar[]): GeoJSON.FeatureCollection {
  // Draw order follows feature order within a layer; selected and top last, dimmed first.
  const order: Role[] = ['other', 'next', 'stop', 'top', 'selected']
  const sorted = [...bars].sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role) || Number(b.dim) - Number(a.dim))
  return {
    type: 'FeatureCollection',
    features: sorted.map((m) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [m.bar.lon, m.bar.lat] },
      properties: {
        id: m.bar.id, role: m.role, type: m.bar.venueType, district: m.bar.district, label: m.label != null ? String(m.label) : '',
        closed: m.closed ? 1 : 0, dim: m.dim ? 1 : 0, mine: m.mine ? 1 : 0,
        pop: m.bar.popularity ?? -1, sat: m.bar.satisfaction ?? -1, minutes: m.minutes ?? 0,
      },
    })),
  }
}

/** A small heart with a white rim, drawn once for the "Meine Lokale" symbol layer. */
function heartImage(): ImageData {
  const size = 48
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d')!
  g.beginPath()
  g.moveTo(24, 41)
  g.bezierCurveTo(6, 29, 4, 19, 8, 13)
  g.bezierCurveTo(12, 7, 21, 7, 24, 14)
  g.bezierCurveTo(27, 7, 36, 7, 40, 13)
  g.bezierCurveTo(44, 19, 42, 29, 24, 41)
  g.closePath()
  g.lineJoin = 'round'
  g.lineWidth = 6
  g.strokeStyle = '#ffffff'
  g.stroke()
  g.fillStyle = MINE_COLOR
  g.fill()
  return g.getImageData(0, 0, size, size)
}

function districtsGeoJson(fc: GeoJSON.FeatureCollection, visited: Set<number>): GeoJSON.FeatureCollection {
  return {
    ...fc,
    features: fc.features.map((f) => ({
      ...f,
      properties: { ...f.properties, visited: visited.has(Number(f.properties?.district)) ? 1 : 0 },
    })),
  }
}

function lines(items: { coords: [number, number][]; mode?: string; color?: string; line?: string }[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: items.filter((i) => i.coords.length > 1).map((i) => ({
      type: 'Feature',
      properties: { mode: i.mode ?? '', color: i.color ?? '#e5484d', line: i.line ?? '' },
      geometry: { type: 'LineString', coordinates: i.coords },
    })),
  }
}

export default function MapView(props: Props) {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<maplibregl.Map | null>(null)
  const ready = useRef(false)
  const hoveredDistrict = useRef<number | null>(null)
  const dwelling = useRef(false)
  const routePill = useRef<maplibregl.Marker | null>(null)
  const dwellTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hoverId = useRef<string | null>(null)
  const anim = useRef<{ hover?: number; wave?: number }>({})
  const latest = useRef(props)
  useLayoutEffect(() => {
    latest.current = props
  })

  function update() {
    const m = map.current
    if (!m || !ready.current) return
    const p = latest.current
    ;(m.getSource('bars') as GeoJSONSource).setData(barsGeoJson(p.bars))
    ;(m.getSource('districts') as GeoJSONSource).setData(districtsGeoJson(p.districts, p.visitedDistricts))
    ;(m.getSource('district-labels') as GeoJSONSource).setData(p.districtLabels)
    ;(m.getSource('outside') as GeoJSONSource).setData(p.viennaMask)
    ;(m.getSource('origin') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: p.origin ? [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [p.origin.lon, p.origin.lat] } }] : [],
    })
    ;(m.getSource('tour') as GeoJSONSource).setData(lines(p.tourLegs))
    ;(m.getSource('rec-lines') as GeoJSONSource).setData(lines(p.recLines.map((coords) => ({ coords }))))
    ;(m.getSource('preview') as GeoJSONSource).setData(lines(p.preview))
    ;(m.getSource('ghosts') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: p.ghosts.map((g) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [g.lon, g.lat] }, properties: { label: String(g.label) } })),
    })
    m.setFilter('bars-highlight', ['==', ['get', 'id'], p.highlightId ?? ''])
  }

  function setDistrictHover(d: number | null) {
    if (d === hoveredDistrict.current) return
    hoveredDistrict.current = d
    // Hovering only outlines the district; staying a while also greys out the rest.
    if (dwellTimer.current) clearTimeout(dwellTimer.current)
    dwelling.current = false
    if (d != null) {
      dwellTimer.current = setTimeout(() => {
        dwelling.current = true
        emphasise()
      }, HOVER_DWELL_MS)
    }
    emphasise()
  }

  /**
   * One district stands out: the focused one (clicked), else the hovered one. The others
   * darken, the district gets a warm glow and, when focused, a soft shadow that lifts it off
   * the map; bars outside a focused district fade.
   */
  function emphasise() {
    const m = map.current
    if (!m || !ready.current) return
    const focused = latest.current.focusDistrict
    const d = focused ?? hoveredDistrict.current
    const strong = focused !== null
    // A hovered district greys out the others only after the dwell time.
    const dims = strong || dwelling.current
    const is: ExpressionSpecification = ['==', ['get', 'district'], d ?? -1]
    // The other districts and everything outside Vienna darken together. The darkened districts
    // are picked by filter and the opacity is a plain number, because MapLibre only animates
    // plain values; a per-feature expression would switch instantly while the outside fades.
    const darkness = d == null || !dims ? 0 : strong ? 0.34 : 0.2
    // Re-target only while darkening: a fade-out keeps its old selection, else the next district
    // would pop out at once while the rest fades.
    if (d != null && darkness > 0) m.setFilter('districts-dim', ['!=', ['get', 'district'], d])
    m.setPaintProperty('districts-dim', 'fill-opacity', darkness)
    m.setPaintProperty('outside-dim', 'fill-opacity', darkness)
    m.setFilter('districts-shadow', ['==', ['get', 'district'], strong ? d : -1])
    m.setFilter('districts-glow', ['==', ['get', 'district'], d ?? -1])
    m.setPaintProperty('districts-glow', 'line-opacity', strong ? 0.95 : 0.6)
    m.setPaintProperty('districts-line', 'line-color', ['case', is, '#121110', '#a29c93'])
    m.setPaintProperty('districts-line', 'line-width', ['case', is, strong ? 3 : 2.4, 1.3])
    m.setPaintProperty('districts-fill', 'fill-opacity', ['case',
      is, ['case', ['==', ['get', 'visited'], 1], 0.16, strong ? 0.03 : 0.06],
      ['==', ['get', 'visited'], 1], 0.07, 0])
    m.setPaintProperty('bars-other', 'circle-opacity', ['case',
      ['==', ['get', 'dim'], 1], 0.28,
      strong ? ['case', is, 0.95, 0.22] : 0.9])
    m.setPaintProperty('district-labels', 'text-opacity', d == null ? 0.55 : ['case', is, 0.95, strong ? 0.3 : 0.45])
    const named: ExpressionSpecification = ['format', ['to-string', ['get', 'district']], { 'font-scale': 1 }, '\n', {}, ['get', 'name'], { 'font-scale': 0.6 }]
    m.setLayoutProperty('district-labels', 'text-field',
      ['step', ['zoom'], ['case', is, named, ['to-string', ['get', 'district']]], 12.6, named])
  }

  function setSize(sizeBy: SizeBy) {
    const m = map.current
    if (!m || !ready.current) return
    m.setPaintProperty('bars-other', 'circle-radius', radius(2.9, 6, sizeBy))
    m.setPaintProperty('bars-next', 'circle-radius', radius(4, 8.2, sizeBy))
    // Big dots underneath, so small ones stay visible; faded ones below all.
    const key = sizeBy === 'none' ? null : scoreKey(sizeBy)
    const sort: ExpressionSpecification | undefined = key
      ? ['+', ['*', 1000, ['-', 1, ['get', 'dim']]], ['-', 100, ['get', key]]] : undefined
    m.setLayoutProperty('bars-other', 'circle-sort-key', sort)
    m.setLayoutProperty('bars-next', 'circle-sort-key', sort)
    // The top step gets an ink outline, so it reads apart from the step below.
    const top: ExpressionSpecification | false = sizeBy !== 'none' && ['>=', ['get', key!], SIZE_STEPS[sizeBy][3].min]
    m.setPaintProperty('bars-other', 'circle-stroke-color', top ? ['case', top, '#121110', '#ffffff'] : '#ffffff')
    m.setPaintProperty('bars-other', 'circle-stroke-width', ['case', ['==', ['get', 'dim'], 1], 0, top ? ['case', top, 1.6, 0.8] : 0.8])
  }

  /** The dot under the mouse grows (feature state) and a ring opens around it. */
  function hoverBar(id: string | null, at: [number, number] | null) {
    const m = map.current
    if (!m || id === hoverId.current) return
    if (hoverId.current) m.setFeatureState({ source: 'bars', id: hoverId.current }, { hover: false })
    hoverId.current = id
    if (anim.current.hover) cancelAnimationFrame(anim.current.hover)
    const src = m.getSource('hover') as GeoJSONSource
    if (!id || !at) {
      src.setData(empty)
      return
    }
    m.setFeatureState({ source: 'bars', id }, { hover: true })
    src.setData({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: at } }] })
    if (reducedMotion()) {
      m.setPaintProperty('bars-hover', 'circle-radius', 13)
      return
    }
    const start = performance.now()
    const step = (now: number) => {
      const t = Math.min(1, Math.max(0, now - start) / 220)
      const ease = 1 - Math.pow(1 - t, 3)
      m.setPaintProperty('bars-hover', 'circle-radius', 6 + 8 * ease)
      m.setPaintProperty('bars-hover', 'circle-stroke-opacity', 0.7 * ease)
      if (t < 1) anim.current.hover = requestAnimationFrame(step)
    }
    anim.current.hover = requestAnimationFrame(step)
  }

  /** Ripple from the origin while the reachable bars appear, nearest first (about a second).
   *  `from`: minutes already shown, so a longer time only reveals the bars it adds. */
  function wave(from = 0) {
    const m = map.current
    if (!m || !ready.current) return
    if (anim.current.wave) cancelAnimationFrame(anim.current.wave)
    const nextOnly: ExpressionSpecification = ['==', ['get', 'role'], 'next']
    if (reducedMotion()) {
      m.setFilter('bars-next', nextOnly)
      return
    }
    const maxMinutes = Math.max(1, ...latest.current.bars.filter((b) => b.role === 'next').map((b) => b.minutes ?? 0))
    const start = performance.now()
    const step = (now: number) => {
      const t = Math.min(1, Math.max(0, now - start) / 1100)
      const ease = 1 - Math.pow(1 - t, 2)
      m.setFilter('bars-next', ['all', nextOnly, ['<=', ['get', 'minutes'], from + ease * (maxMinutes - from)]])
      m.setPaintProperty('origin-wave', 'circle-radius', 10 + 230 * ease)
      m.setPaintProperty('origin-wave', 'circle-opacity', 1 - t)
      m.setPaintProperty('origin-wave', 'circle-stroke-opacity', 1 - t)
      if (t < 1) anim.current.wave = requestAnimationFrame(step)
      else m.setFilter('bars-next', nextOnly)
    }
    anim.current.wave = requestAnimationFrame(step)
  }

  useEffect(() => {
    if (!container.current) return
    const m = new maplibregl.Map({
      container: container.current,
      style: STYLE,
      center: [16.373, 48.208],
      zoom: 11.6,
      // Compact credits, bottom left; CSS shows them on phones only, where the footer is hidden.
      attributionControl: false,
    })
    map.current = m
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left')
    m.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left')

    m.on('load', () => {
      for (const [layer, paint] of Object.entries(BASEMAP)) {
        if (!m.getLayer(layer)) continue
        for (const [prop, value] of Object.entries(paint)) m.setPaintProperty(layer, prop as keyof AllPaintProperties, value)
      }
      m.addSource('outside', { type: 'geojson', data: empty })
      m.addSource('districts', { type: 'geojson', data: empty, promoteId: 'district' })
      // Outside Vienna: a permanent light wash, so the city stands out; darkens with district focus.
      m.addLayer({
        id: 'outside-wash', type: 'fill', source: 'outside',
        paint: { 'fill-color': '#f4f2ed', 'fill-opacity': 0.75 },
      })
      m.addLayer({
        id: 'outside-dim', type: 'fill', source: 'outside',
        paint: { 'fill-color': '#121110', 'fill-opacity': 0, 'fill-opacity-transition': { duration: 300, delay: 0 } },
      })
      m.addSource('district-labels', { type: 'geojson', data: empty })
      m.addSource('tour', { type: 'geojson', data: empty })
      m.addSource('rec-lines', { type: 'geojson', data: empty })
      m.addSource('preview', { type: 'geojson', data: empty })
      m.addSource('bars', { type: 'geojson', data: empty, promoteId: 'id' })
      m.addSource('ghosts', { type: 'geojson', data: empty })
      m.addSource('origin', { type: 'geojson', data: empty })
      m.addSource('hover', { type: 'geojson', data: empty })

      m.addLayer({
        id: 'districts-fill', type: 'fill', source: 'districts',
        paint: {
          'fill-color': ['case', ['==', ['get', 'visited'], 1], '#D4FF3A', '#121110'],
          'fill-opacity': ['case',
            ['boolean', ['feature-state', 'hover'], false], ['case', ['==', ['get', 'visited'], 1], 0.3, 0.08],
            ['==', ['get', 'visited'], 1], 0.07, 0],
        },
      })
      m.addLayer({
        id: 'districts-dim', type: 'fill', source: 'districts',
        paint: { 'fill-color': '#121110', 'fill-opacity': 0, 'fill-opacity-transition': { duration: 300, delay: 0 } },
      })
      // Soft drop shadow under the focused district, so it looks lifted off the map.
      m.addLayer({
        id: 'districts-shadow', type: 'line', source: 'districts', filter: ['==', ['get', 'district'], -1],
        layout: { 'line-join': 'round' },
        paint: { 'line-color': '#121110', 'line-width': 18, 'line-blur': 16, 'line-opacity': 0.45, 'line-translate': [0, 7] },
      })
      m.addLayer({
        id: 'districts-casing', type: 'line', source: 'districts',
        paint: { 'line-color': '#ffffff', 'line-width': 3.5, 'line-opacity': 0.9 },
      })
      m.addLayer({
        id: 'districts-line', type: 'line', source: 'districts',
        paint: {
          'line-color': ['case', ['boolean', ['feature-state', 'hover'], false], '#121110', '#a29c93'],
          'line-width': ['case', ['boolean', ['feature-state', 'hover'], false], 2.6, 1.3],
        },
      })
      m.addLayer({
        id: 'districts-glow', type: 'line', source: 'districts', filter: ['==', ['get', 'district'], -1],
        layout: { 'line-join': 'round' },
        paint: { 'line-color': '#D4FF3A', 'line-width': 9, 'line-blur': 5, 'line-opacity': 0.6 },
      })
      m.addLayer({
        id: 'district-labels', type: 'symbol', source: 'district-labels',
        layout: {
          'text-field': ['step', ['zoom'],
            ['to-string', ['get', 'district']],
            12.6, ['format', ['to-string', ['get', 'district']], { 'font-scale': 1 }, '\n', {}, ['get', 'name'], { 'font-scale': 0.6 }]],
          'text-font': FONT,
          'text-size': ['interpolate', ['linear'], ['zoom'], 10, 13, 14, 20],
        },
        paint: { 'text-color': '#4a4641', 'text-opacity': 0.55, 'text-halo-color': '#ffffff', 'text-halo-width': 2 },
      })
      m.addLayer({
        id: 'rec-lines', type: 'line', source: 'rec-lines',
        paint: { 'line-color': '#121110', 'line-width': 1.2, 'line-dasharray': [1.5, 2], 'line-opacity': 0.45 },
      })
      m.addLayer({
        id: 'tour-casing', type: 'line', source: 'tour', layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#ffffff', 'line-width': 8, 'line-opacity': 0.9 },
      })
      // Legs: walking solid dark; rides in their line colour; walking within a transit leg dotted;
      // transit legs without a known route as a dashed arc.
      const legLayers = (source: string, opacity: number) => {
        m.addLayer({
          id: `${source}-walk`, type: 'line', source, filter: ['==', ['get', 'mode'], 'walk'],
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': '#121110', 'line-width': 4, 'line-opacity': opacity },
        })
        m.addLayer({
          id: `${source}-transfer`, type: 'line', source, filter: ['==', ['get', 'mode'], 'transfer'],
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': '#121110', 'line-width': 2.5, 'line-dasharray': [0.6, 1.6], 'line-opacity': opacity },
        })
        m.addLayer({
          id: `${source}-ride`, type: 'line', source, filter: ['==', ['get', 'mode'], 'ride'],
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': ['get', 'color'], 'line-width': 5.5, 'line-opacity': opacity },
        })
        m.addLayer({
          id: `${source}-pending`, type: 'line', source, filter: ['==', ['get', 'mode'], 'pending'],
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': '#e5484d', 'line-width': 2.5, 'line-dasharray': [1, 1.6], 'line-opacity': 0.75 * opacity },
        })
        m.addLayer({
          id: `${source}-gap`, type: 'line', source, filter: ['==', ['get', 'mode'], 'gap'],
          layout: { 'line-cap': 'round' },
          paint: { 'line-color': '#827d76', 'line-width': 2, 'line-dasharray': [1.5, 2], 'line-opacity': opacity },
        })
        m.addLayer({
          id: `${source}-lines`, type: 'symbol', source, filter: ['==', ['get', 'mode'], 'ride'],
          layout: {
            'symbol-placement': 'line-center', 'text-field': ['get', 'line'], 'text-font': FONT, 'text-size': 12,
            'text-allow-overlap': true, 'text-rotation-alignment': 'viewport', 'text-keep-upright': true,
          },
          paint: { 'text-color': '#ffffff', 'text-halo-color': ['get', 'color'], 'text-halo-width': 3, 'text-opacity': opacity },
        })
      }
      legLayers('tour', 1)
      m.addLayer({
        id: 'preview-casing', type: 'line', source: 'preview', layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#ffffff', 'line-width': 7, 'line-opacity': 0.8 },
      })
      legLayers('preview', 0.85)

      m.addLayer({
        id: 'ghosts', type: 'circle', source: 'ghosts',
        paint: { 'circle-radius': 12, 'circle-color': '#ffffff', 'circle-opacity': 0.9, 'circle-stroke-color': '#827d76', 'circle-stroke-width': 1.5 },
      })
      m.addLayer({
        id: 'ghost-labels', type: 'symbol', source: 'ghosts',
        layout: { 'text-field': ['get', 'label'], 'text-font': FONT, 'text-size': 12, 'text-allow-overlap': true },
        paint: { 'text-color': '#827d76' },
      })
      // A ripple from a new origin, out to the bars in reach (see wave()).
      m.addLayer({
        id: 'origin-wave', type: 'circle', source: 'origin',
        paint: { 'circle-radius': 0, 'circle-color': 'rgba(37,99,235,0.10)', 'circle-stroke-color': 'rgba(37,99,235,0.5)', 'circle-stroke-width': 1.5, 'circle-opacity': 0, 'circle-stroke-opacity': 0 },
      })
      m.addLayer({
        id: 'origin-halo', type: 'circle', source: 'origin',
        paint: { 'circle-radius': 22, 'circle-color': 'rgba(37,99,235,0.16)', 'circle-stroke-color': 'rgba(37,99,235,0.35)', 'circle-stroke-width': 1 },
      })
      m.addLayer({
        id: 'origin', type: 'circle', source: 'origin',
        paint: { 'circle-radius': 8, 'circle-color': '#2563eb', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 3 },
      })
      const hollow = (color: string) => ['case', ['==', ['get', 'closed'], 1], '#ffffff', color] as unknown as string
      m.addLayer({
        id: 'bars-other', type: 'circle', source: 'bars', filter: ['==', ['get', 'role'], 'other'],
        paint: {
          // Size: one for all, or by Beliebtheit / Zufriedenheit (setSize).
          'circle-radius': radius(2.9, 6, 'none'),
          'circle-color': typeColor,
          'circle-opacity': ['case', ['==', ['get', 'dim'], 1], 0.28, 0.9],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': ['case', ['==', ['get', 'dim'], 1], 0, 0.8],
        },
      })
      m.addLayer({
        id: 'bars-next', type: 'circle', source: 'bars', filter: ['==', ['get', 'role'], 'next'],
        paint: {
          'circle-radius': radius(4, 8.2, 'none'), 'circle-color': hollow(typeColor),
          'circle-stroke-color': ['case', ['==', ['get', 'closed'], 1], typeColor, '#ffffff'],
          'circle-stroke-width': ['case', ['==', ['get', 'closed'], 1], 2.5, 2],
        },
      })
      m.addLayer({
        id: 'bars-stop', type: 'circle', source: 'bars', filter: ['==', ['get', 'role'], 'stop'],
        paint: {
          // Tour stops: ink discs with a lime ring.
          'circle-radius': 12, 'circle-color': hollow('#121110'),
          'circle-stroke-color': ['case', ['==', ['get', 'closed'], 1], '#121110', '#D4FF3A'],
          'circle-stroke-width': 3,
        },
      })
      m.addLayer({
        id: 'bars-top', type: 'circle', source: 'bars', filter: ['==', ['get', 'role'], 'top'],
        paint: {
          // Numbered suggestions: white discs, ink outline and numerals.
          'circle-radius': 12, 'circle-color': '#ffffff',
          'circle-stroke-color': '#121110',
          'circle-stroke-width': ['case', ['==', ['get', 'closed'], 1], 1.5, 2],
        },
      })
      m.addLayer({
        id: 'bars-highlight', type: 'circle', source: 'bars', filter: ['==', ['get', 'id'], ''],
        paint: { 'circle-radius': 17, 'circle-color': SELECT_HALO, 'circle-stroke-color': '#121110', 'circle-stroke-width': 1.5 },
      })
      // The hovered bar: a soft ring that opens up (animated in hoverBar()).
      m.addLayer({
        id: 'bars-hover', type: 'circle', source: 'hover',
        paint: { 'circle-radius': 0, 'circle-color': 'rgba(255,255,255,0.35)', 'circle-stroke-color': '#121110', 'circle-stroke-width': 1.5, 'circle-stroke-opacity': 0.7 },
      })
      m.addLayer({
        id: 'bars-selected-ring', type: 'circle', source: 'bars', filter: ['==', ['get', 'role'], 'selected'],
        paint: { 'circle-radius': 19, 'circle-color': SELECT_HALO, 'circle-stroke-color': 'rgba(18,17,16,0.55)', 'circle-stroke-width': 1 },
      })
      m.addLayer({
        id: 'bars-selected', type: 'circle', source: 'bars', filter: ['==', ['get', 'role'], 'selected'],
        paint: { 'circle-radius': 10, 'circle-color': SELECT_COLOR, 'circle-stroke-color': '#121110', 'circle-stroke-width': 2.5 },
      })
      m.addLayer({
        id: 'bars-labels', type: 'symbol', source: 'bars',
        filter: ['all', ['in', ['get', 'role'], ['literal', ['top', 'stop', 'selected']]], ['!=', ['get', 'label'], '']],
        layout: { 'text-field': ['get', 'label'], 'text-font': FONT, 'text-size': 12.5, 'text-allow-overlap': true },
        // Ink on the white suggestion and yellow selection discs, white on the ink tour stops.
        paint: { 'text-color': ['case', ['all', ['==', ['get', 'role'], 'stop'], ['!=', ['get', 'closed'], 1]], '#ffffff', '#121110'] },
      })
      if (!m.hasImage('heart')) m.addImage('heart', heartImage(), { pixelRatio: 2 })
      m.addLayer({
        id: 'bars-mine', type: 'symbol', source: 'bars', filter: ['==', ['get', 'mine'], 1],
        layout: {
          'icon-image': 'heart', 'icon-allow-overlap': true, 'icon-ignore-placement': true,
          'icon-size': ['interpolate', ['linear'], ['zoom'], 11, 0.6, 15, 0.85],
          // Above-right of the dot, so the type colour stays visible.
          'icon-offset': [9, -9],
        },
        paint: { 'icon-opacity': ['case', ['==', ['get', 'dim'], 1], 0.45, 1] },
      })

      m.on('click', (e) => {
        const hit = m.queryRenderedFeatures(e.point, { layers: BAR_LAYERS.filter((l) => m.getLayer(l)) })
        if (hit.length) return
        const d = m.queryRenderedFeatures(e.point, { layers: ['districts-fill'] })[0]?.properties?.district
        latest.current.onBackgroundClick(d ? Number(d) : null, { lat: e.lngLat.lat, lon: e.lngLat.lng })
      })
      m.on('contextmenu', (e) => {
        latest.current.onContextPoint?.({ lat: e.lngLat.lat, lon: e.lngLat.lng })
      })
      for (const layer of BAR_LAYERS) {
        m.on('click', layer, (e: MapLayerMouseEvent) => {
          const id = e.features?.[0]?.properties?.id
          if (id) latest.current.onSelect(String(id))
        })
        m.on('mousemove', layer, (e: MapLayerMouseEvent) => {
          const f = e.features?.[0]
          const id = f?.properties?.id
          if (!id) return
          m.getCanvas().style.cursor = 'pointer'
          hoverBar(String(id), (f.geometry as GeoJSON.Point).coordinates as [number, number])
          latest.current.onHoverBar({ id: String(id), x: e.point.x, y: e.point.y })
        })
        m.on('mouseleave', layer, () => {
          m.getCanvas().style.cursor = ''
          hoverBar(null, null)
          latest.current.onHoverBar(null)
        })
      }
      m.on('mousemove', 'districts-fill', (e: MapLayerMouseEvent) => {
        const d = Number(e.features?.[0]?.properties?.district)
        if (!d) return
        setDistrictHover(d)
        latest.current.onHoverDistrict({ district: d, x: e.point.x, y: e.point.y })
      })
      m.on('mouseleave', 'districts-fill', () => {
        setDistrictHover(null)
        latest.current.onHoverDistrict(null)
      })
      // Credits start folded to their ⓘ button rather than as a banner over the map.
      container.current?.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show')
      ready.current = true
      // For tests and tools: the map now has its sources, layers and handlers.
      if (container.current) container.current.dataset.ready = '1'
      update()
      emphasise()
      setSize(latest.current.sizeBy)
    })
    return () => {
      if (dwellTimer.current) clearTimeout(dwellTimer.current)
      if (anim.current.hover) cancelAnimationFrame(anim.current.hover)
      if (anim.current.wave) cancelAnimationFrame(anim.current.wave)
      ready.current = false
      m.remove()
      map.current = null
    }
  }, [])

  useEffect(() => setSize(props.sizeBy), [props.sizeBy])

  // A new origin, travel mode or time: a ripple goes out and the bars in reach appear in order of
  // travel time. A longer time keeps what was shown and only adds the rest.
  const lastReach = useRef<{ key: string; minutes: number } | null>(null)
  useEffect(() => {
    const r = props.reach
    const prev = lastReach.current
    lastReach.current = r ?? null
    if (!r) return
    wave(prev && prev.key === r.key && r.minutes > prev.minutes ? prev.minutes : 0)
  }, [props.reach?.key, props.reach?.minutes])

  useEffect(update, [props.bars, props.districts, props.districtLabels, props.viennaMask, props.visitedDistricts, props.tourLegs,
    props.recLines, props.preview, props.ghosts, props.origin, props.highlightId])

  // The travel-time pill on the finder route; an HTML marker so it can look like a badge.
  useEffect(() => {
    const m = map.current
    const l = props.routeLabel
    if (!m || !l) {
      routePill.current?.remove()
      routePill.current = null
      return
    }
    if (!routePill.current) {
      const el = document.createElement('div')
      el.className = 'route-pill'
      routePill.current = new maplibregl.Marker({ element: el }).setLngLat([l.lon, l.lat]).addTo(m)
    }
    routePill.current.setLngLat([l.lon, l.lat])
    routePill.current.getElement().textContent = l.text
  }, [props.routeLabel])

  // Focus on a district: emphasise it and zoom so it fills the map left of the panel.
  useEffect(() => {
    emphasise()
    const m = map.current
    if (!m || props.focusDistrict === null) return
    const f = props.districts.features.find((x) => Number(x.properties?.district) === props.focusDistrict)
    if (!f) return
    const b = new maplibregl.LngLatBounds()
    const walk = (c: unknown): void => {
      if (Array.isArray(c) && typeof c[0] === 'number') b.extend(c as [number, number])
      else if (Array.isArray(c)) c.forEach(walk)
    }
    walk((f.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon).coordinates)
    const { right, bottom } = latest.current.inset
    m.fitBounds(b, { padding: { top: 70, bottom: 70 + bottom, left: 70, right: 70 + right }, duration: 800, maxZoom: 15.5 })
  }, [props.focusDistrict, props.districts])

  useEffect(() => {
    if (props.focus && map.current) {
      // Centre the bar in the part of the map that the panel or sheet leaves free.
      const { right, bottom } = latest.current.inset
      map.current.easeTo({
        center: [props.focus.lon, props.focus.lat], zoom: Math.max(map.current.getZoom(), 13.5), duration: 700,
        offset: [-right / 2, -bottom / 2],
      })
    }
  }, [props.focus])

  return <div ref={container} className="map" data-testid="map" />
}
