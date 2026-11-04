import * as maplibregl from 'maplibre-gl'
import type { GeoJSONSource, MapLayerMouseEvent } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useEffect, useLayoutEffect, useRef } from 'react'
import type { Bar } from '../domain/types'
import { TYPE_COLOR } from '../theme'

const STYLE = 'https://tiles.openfreemap.org/styles/liberty'
const FONT = ['Noto Sans Bold']

export type Role = 'selected' | 'stop' | 'top' | 'next' | 'other'

export interface MapBar {
  bar: Bar
  role: Role
  /** Number on the marker: rank for recommendations, position for tour stops. */
  label?: number
  closed?: boolean
  /** Fade it: a bar is selected and this one isn't relevant to it. */
  dim?: boolean
}

export interface Leg {
  coords: [number, number][]
  mode: 'walk' | 'transit'
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
  visitedDistricts: Set<number>
  tourLegs: Leg[]
  recLines: [number, number][][]
  preview: Leg | null
  highlightId: string | null
  focus: { lat: number; lon: number; key: number } | null
  onSelect: (id: string) => void
  onHoverBar: (h: HoverInfo | null) => void
  onHoverDistrict: (h: { district: number; x: number; y: number } | null) => void
}

const BAR_LAYERS = ['bars-other', 'bars-next', 'bars-top', 'bars-stop', 'bars-selected']
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
        id: m.bar.id, role: m.role, type: m.bar.venueType, label: m.label != null ? String(m.label) : '',
        closed: m.closed ? 1 : 0, dim: m.dim ? 1 : 0,
        rich: m.bar.tags.length + (m.bar.tips?.length ?? 0) > 1 ? 1 : 0,
      },
    })),
  }
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

function lines(items: { coords: [number, number][]; mode?: string }[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: items.filter((i) => i.coords.length > 1).map((i) => ({
      type: 'Feature', properties: { mode: i.mode ?? '' }, geometry: { type: 'LineString', coordinates: i.coords },
    })),
  }
}

export default function MapView(props: Props) {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<maplibregl.Map | null>(null)
  const ready = useRef(false)
  const hoveredDistrict = useRef<number | null>(null)
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
    ;(m.getSource('tour') as GeoJSONSource).setData(lines(p.tourLegs))
    ;(m.getSource('rec-lines') as GeoJSONSource).setData(lines(p.recLines.map((coords) => ({ coords }))))
    ;(m.getSource('preview') as GeoJSONSource).setData(lines(p.preview ? [p.preview] : []))
    m.setFilter('bars-highlight', ['==', ['get', 'id'], p.highlightId ?? ''])
  }

  function setDistrictHover(d: number | null) {
    const m = map.current
    if (!m || d === hoveredDistrict.current) return
    if (hoveredDistrict.current != null) m.setFeatureState({ source: 'districts', id: hoveredDistrict.current }, { hover: false })
    hoveredDistrict.current = d
    if (d != null) m.setFeatureState({ source: 'districts', id: d }, { hover: true })
    // Other districts fade, so the hovered one stands out.
    m.setPaintProperty('districts-dim', 'fill-opacity', d == null ? 0 : ['case', ['==', ['get', 'district'], d], 0, 0.42])
  }

  useEffect(() => {
    if (!container.current) return
    const m = new maplibregl.Map({
      container: container.current,
      style: STYLE,
      center: [16.373, 48.208],
      zoom: 11.6,
      attributionControl: { compact: true },
    })
    map.current = m
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right')

    m.on('load', () => {
      m.addSource('districts', { type: 'geojson', data: empty, promoteId: 'district' })
      m.addSource('district-labels', { type: 'geojson', data: empty })
      m.addSource('tour', { type: 'geojson', data: empty })
      m.addSource('rec-lines', { type: 'geojson', data: empty })
      m.addSource('preview', { type: 'geojson', data: empty })
      m.addSource('bars', { type: 'geojson', data: empty })

      m.addLayer({
        id: 'districts-fill', type: 'fill', source: 'districts',
        paint: {
          'fill-color': ['case', ['==', ['get', 'visited'], 1], '#f59e0b', '#7c4a1e'],
          'fill-opacity': ['case',
            ['boolean', ['feature-state', 'hover'], false], ['case', ['==', ['get', 'visited'], 1], 0.3, 0.08],
            ['==', ['get', 'visited'], 1], 0.18, 0],
        },
      })
      m.addLayer({
        id: 'districts-dim', type: 'fill', source: 'districts',
        paint: { 'fill-color': '#f8f5f0', 'fill-opacity': 0, 'fill-opacity-transition': { duration: 250, delay: 0 } },
      })
      m.addLayer({
        id: 'districts-casing', type: 'line', source: 'districts',
        paint: { 'line-color': '#ffffff', 'line-width': ['case', ['boolean', ['feature-state', 'hover'], false], 6, 3.5], 'line-opacity': 0.9 },
      })
      m.addLayer({
        id: 'districts-line', type: 'line', source: 'districts',
        paint: {
          'line-color': ['case', ['boolean', ['feature-state', 'hover'], false], '#3b2414', '#8a6a48'],
          'line-width': ['case', ['boolean', ['feature-state', 'hover'], false], 2.6, 1.3],
        },
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
        paint: { 'text-color': '#6b4a2b', 'text-opacity': 0.55, 'text-halo-color': '#ffffff', 'text-halo-width': 2 },
      })
      m.addLayer({
        id: 'rec-lines', type: 'line', source: 'rec-lines',
        paint: { 'line-color': '#c2410c', 'line-width': 1.5, 'line-dasharray': [1.5, 2], 'line-opacity': 0.7 },
      })
      m.addLayer({
        id: 'tour-casing', type: 'line', source: 'tour', layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#ffffff', 'line-width': 8, 'line-opacity': 0.9 },
      })
      m.addLayer({
        id: 'tour', type: 'line', source: 'tour', filter: ['==', ['get', 'mode'], 'walk'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#3b2414', 'line-width': 4.5 },
      })
      m.addLayer({
        id: 'tour-transit', type: 'line', source: 'tour', filter: ['==', ['get', 'mode'], 'transit'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#dc2626', 'line-width': 4, 'line-dasharray': [1, 1.6] },
      })
      m.addLayer({
        id: 'preview', type: 'line', source: 'preview', layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['case', ['==', ['get', 'mode'], 'transit'], '#dc2626', '#c2410c'],
          'line-width': 3.5, 'line-opacity': 0.85, 'line-dasharray': [1.2, 1.2],
        },
      })

      const hollow = (color: string) => ['case', ['==', ['get', 'closed'], 1], '#ffffff', color] as unknown as string
      m.addLayer({
        id: 'bars-other', type: 'circle', source: 'bars', filter: ['==', ['get', 'role'], 'other'],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'],
            11, ['case', ['==', ['get', 'rich'], 1], 3.4, 2.6],
            15, ['case', ['==', ['get', 'rich'], 1], 7, 5.5]],
          'circle-color': typeColor,
          'circle-opacity': ['case', ['==', ['get', 'dim'], 1], 0.28, 0.9],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': ['case', ['==', ['get', 'dim'], 1], 0, 0.8],
        },
      })
      m.addLayer({
        id: 'bars-next', type: 'circle', source: 'bars', filter: ['==', ['get', 'role'], 'next'],
        paint: {
          'circle-radius': 7, 'circle-color': hollow(typeColor),
          'circle-stroke-color': ['case', ['==', ['get', 'closed'], 1], typeColor, '#ffffff'],
          'circle-stroke-width': ['case', ['==', ['get', 'closed'], 1], 2.5, 2],
        },
      })
      m.addLayer({
        id: 'bars-stop', type: 'circle', source: 'bars', filter: ['==', ['get', 'role'], 'stop'],
        paint: {
          'circle-radius': 12, 'circle-color': hollow('#3b2414'),
          'circle-stroke-color': ['case', ['==', ['get', 'closed'], 1], '#3b2414', '#fbbf24'],
          'circle-stroke-width': 3,
        },
      })
      m.addLayer({
        id: 'bars-top', type: 'circle', source: 'bars', filter: ['==', ['get', 'role'], 'top'],
        paint: {
          'circle-radius': 13, 'circle-color': hollow('#c2410c'),
          'circle-stroke-color': ['case', ['==', ['get', 'closed'], 1], '#c2410c', '#ffffff'],
          'circle-stroke-width': 3,
        },
      })
      m.addLayer({
        id: 'bars-highlight', type: 'circle', source: 'bars', filter: ['==', ['get', 'id'], ''],
        paint: { 'circle-radius': 20, 'circle-color': 'rgba(194,65,12,0.15)', 'circle-stroke-color': '#c2410c', 'circle-stroke-width': 2.5 },
      })
      m.addLayer({
        id: 'bars-selected-ring', type: 'circle', source: 'bars', filter: ['==', ['get', 'role'], 'selected'],
        paint: { 'circle-radius': 21, 'circle-color': 'rgba(17,24,39,0.12)', 'circle-stroke-color': '#111827', 'circle-stroke-width': 3 },
      })
      m.addLayer({
        id: 'bars-selected', type: 'circle', source: 'bars', filter: ['==', ['get', 'role'], 'selected'],
        paint: { 'circle-radius': 11, 'circle-color': '#111827', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 3 },
      })
      m.addLayer({
        id: 'bars-labels', type: 'symbol', source: 'bars',
        filter: ['all', ['in', ['get', 'role'], ['literal', ['top', 'stop', 'selected']]], ['!=', ['get', 'label'], '']],
        layout: { 'text-field': ['get', 'label'], 'text-font': FONT, 'text-size': 12.5, 'text-allow-overlap': true },
        paint: { 'text-color': ['case', ['==', ['get', 'closed'], 1], '#111827', '#ffffff'] },
      })

      for (const layer of BAR_LAYERS) {
        m.on('click', layer, (e: MapLayerMouseEvent) => {
          const id = e.features?.[0]?.properties?.id
          if (id) latest.current.onSelect(String(id))
        })
        m.on('mousemove', layer, (e: MapLayerMouseEvent) => {
          const id = e.features?.[0]?.properties?.id
          if (!id) return
          m.getCanvas().style.cursor = 'pointer'
          latest.current.onHoverBar({ id: String(id), x: e.point.x, y: e.point.y })
        })
        m.on('mouseleave', layer, () => {
          m.getCanvas().style.cursor = ''
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
      ready.current = true
      update()
    })
    return () => {
      ready.current = false
      m.remove()
      map.current = null
    }
  }, [])

  useEffect(update, [props.bars, props.districts, props.districtLabels, props.visitedDistricts, props.tourLegs,
    props.recLines, props.preview, props.highlightId])

  useEffect(() => {
    if (props.focus && map.current) {
      map.current.easeTo({ center: [props.focus.lon, props.focus.lat], zoom: Math.max(map.current.getZoom(), 13.5), duration: 700 })
    }
  }, [props.focus])

  return <div ref={container} className="map" data-testid="map" />
}
