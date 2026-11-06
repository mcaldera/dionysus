// "Atlas": every bar as a dot, placed by its profile (t-SNE of style, audience, drinks, features
// and description). Close dots are similar bars; the axes mean nothing. Positions and the 10
// nearest bars come precomputed from the pipeline (pipeline/private/similarity.py).

import { useMemo, useRef, useState } from 'react'
import { VENUE_TYPES, type Bar } from '../domain/types'
import { SELECT_COLOR, TYPE_COLOR, TYPE_SHORT } from '../theme'

export type AtlasColor = 'type' | 'popularity' | 'satisfaction'

interface Props {
  /** Bars that pass the filters; only those with a profile are drawn. */
  bars: Bar[]
  /** All bars by matrix index, to resolve similar bars outside the filter. */
  byIndex: Map<number, Bar>
  selectedId: string | null
  highlightId: string | null
  color: AtlasColor
  onColor: (c: AtlasColor) => void
  /** Space taken by the panel, in pixels. */
  inset: { right: number; bottom: number }
  onSelect: (id: string) => void
  onBackground: () => void
}

/** Similar bars linked in the atlas and listed in the panel. */
export const SIMILAR_SHOWN = 5
const SIZE = 1000
const PAD = 30

/** Light to dark green for 0-100 scores; grey when unknown. */
function ramp(v: number | undefined): string {
  if (v == null) return '#c9c4bb'
  const t = Math.max(0, Math.min(1, v / 100))
  const mix = (a: number, b: number) => Math.round(a + (b - a) * t)
  return `rgb(${mix(178, 12)}, ${mix(214, 84)}, ${mix(196, 62)})`
}

function fill(bar: Bar, color: AtlasColor): string {
  if (color === 'popularity') return ramp(bar.popularity)
  if (color === 'satisfaction') return ramp(bar.satisfaction)
  return TYPE_COLOR[bar.venueType]
}

/** A stable pseudo-random delay per bar, so the dots fade in like a cloud forming (0-500 ms). */
const entryDelay = (i: number) => (i * 7919) % 500

const pos = (b: Bar) => [PAD + b.profile!.xy[0] * (SIZE - 2 * PAD), PAD + (1 - b.profile!.xy[1]) * (SIZE - 2 * PAD)] as const

export default function Atlas({ bars, byIndex, selectedId, highlightId, color, onColor, inset, onSelect, onBackground }: Props) {
  const svg = useRef<SVGSVGElement>(null)
  const [view, setView] = useState({ x: 0, y: 0, k: 1 })
  const [hover, setHover] = useState<{ bar: Bar; x: number; y: number } | null>(null)
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null)

  const shown = useMemo(() => bars.filter((b) => b.profile), [bars])
  const selected = useMemo(() => {
    for (const b of byIndex.values()) if (b.id === selectedId && b.profile) return b
    return null
  }, [byIndex, selectedId])
  // The same five, in the same order, as "Ähnliche Lokale" in the panel.
  const similar = useMemo(() => (selected?.profile?.similar ?? []).map((i) => byIndex.get(i)).filter((b): b is Bar => !!b?.profile).slice(0, SIMILAR_SHOWN),
    [selected, byIndex])
  const similarIds = useMemo(() => new Set(similar.map((b) => b.id)), [similar])

  // Screen pixels per SVG unit, for zooming around the cursor.
  function toSvg(clientX: number, clientY: number) {
    const r = svg.current!.getBoundingClientRect()
    const scale = Math.min(r.width, r.height) / SIZE
    const ox = (r.width - SIZE * scale) / 2
    const oy = (r.height - SIZE * scale) / 2
    return { x: (clientX - r.left - ox) / scale, y: (clientY - r.top - oy) / scale, scale }
  }

  function onWheel(e: React.WheelEvent) {
    const p = toSvg(e.clientX, e.clientY)
    const k = Math.max(1, Math.min(12, view.k * Math.exp(-e.deltaY * 0.0015)))
    // Keep the point under the cursor in place.
    const wx = (p.x - view.x) / view.k
    const wy = (p.y - view.y) / view.k
    setView({ k, x: k === 1 ? 0 : p.x - wx * k, y: k === 1 ? 0 : p.y - wy * k })
  }

  const r = 5.5 / Math.sqrt(view.k)
  const sel = selected ? pos(selected) : null

  return (
    <div className="atlas" style={{ paddingRight: inset.right, paddingBottom: inset.bottom }} onMouseLeave={() => setHover(null)}>
      <svg ref={svg} viewBox={`0 0 ${SIZE} ${SIZE}`} preserveAspectRatio="xMidYMid meet" role="img"
        aria-label="Atlas: Lokale nach Ähnlichkeit angeordnet"
        onWheel={onWheel}
        onPointerDown={(e) => { drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false } }}
        onPointerMove={(e) => {
          const d = drag.current
          if (!d) return
          const { scale } = toSvg(e.clientX, e.clientY)
          const dx = (e.clientX - d.x) / scale
          const dy = (e.clientY - d.y) / scale
          if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true
          if (d.moved && view.k > 1) setView((v) => ({ ...v, x: d.vx + dx, y: d.vy + dy }))
        }}
        onPointerUp={(e) => {
          const d = drag.current
          drag.current = null
          if (d && !d.moved && (e.target as Element).tagName === 'svg') onBackground()
        }}>
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {sel && similar.map((b) => {
            const [x, y] = pos(b)
            // Keyed by both ends, so the line draws again for a new selection.
            return <line key={`${selected!.id}-${b.id}`} x1={sel[0]} y1={sel[1]} x2={x} y2={y} pathLength={1} className="atlas-link" strokeWidth={1.4 / view.k} />
          })}
          {shown.map((b) => {
            const [x, y] = pos(b)
            const dim = !!selected && b.id !== selected.id && !similarIds.has(b.id)
            return (
              <circle key={b.id} cx={x} cy={y} r={r} fill={fill(b, color)} className={dim ? 'atlas-dot dim' : 'atlas-dot'}
                strokeWidth={1 / view.k} style={{ '--d': `${entryDelay(b.matrixIndex)}ms` } as React.CSSProperties}
                onPointerEnter={(e) => setHover({ bar: b, x: e.clientX, y: e.clientY })}
                onPointerLeave={() => setHover((h) => (h?.bar.id === b.id ? null : h))}
                onClick={(e) => { e.stopPropagation(); onSelect(b.id) }} />
            )
          })}
          {similar.map((b, i) => {
            const [x, y] = pos(b)
            return (
              <g key={`${selected!.id}-${b.id}`} pointerEvents="none">
                <circle cx={x} cy={y} r={r * 1.5} className="atlas-ring" strokeWidth={2 / view.k} />
                <text x={x + r * 2.2} y={y + r * 0.9} className="atlas-rank" fontSize={20 / Math.sqrt(view.k)}>{i + 1}</text>
              </g>
            )
          })}
          {[selected, highlightId ? shown.find((b) => b.id === highlightId) : null].map((b, i) => {
            if (!b) return null
            const [x, y] = pos(b)
            return (
              <g key={`${i}-${b.id}`} pointerEvents="none">
                {i === 0 && <circle cx={x} cy={y} r={r * 1.9} className="atlas-pulse" fill="none" stroke="#121110" strokeWidth={1.5 / view.k} />}
                <circle cx={x} cy={y} r={r * 1.9} fill={SELECT_COLOR} className="atlas-selected" strokeWidth={2.2 / view.k} />
              </g>
            )
          })}
        </g>
      </svg>
      {hover && (
        // Flips to the left of the cursor near the panel, so it isn't hidden behind it.
        <div className="hover-card" style={hover.x > window.innerWidth - inset.right - 300
          ? { position: 'fixed', right: window.innerWidth - hover.x + 14, top: hover.y + 12 }
          : { position: 'fixed', left: hover.x + 14, top: hover.y + 12 }}>
          <strong>{hover.bar.name}</strong>
          <div className="rec-meta">
            <span><i className="type-dot" style={{ background: TYPE_COLOR[hover.bar.venueType] }} /> {TYPE_SHORT[hover.bar.venueType]}</span>
            <span> · {hover.bar.district}. Bezirk</span>
          </div>
          {hover.bar.keywords && <div className="atlas-keywords">{hover.bar.keywords.slice(0, 5).join(' · ')}</div>}
        </div>
      )}
      <div className="map-legend atlas-legend" aria-label="Legende">
        <div className="segmented" role="group" aria-label="Farbe">
          {([['type', 'Typ'], ['popularity', 'Beliebtheit'], ['satisfaction', 'Zufriedenheit']] as const).map(([c, label]) => (
            <button key={c} type="button" aria-pressed={color === c} onClick={() => onColor(c)}>{label}</button>
          ))}
        </div>
        {color === 'type' ? (
          <div>{VENUE_TYPES.map((t) => <span key={t}><i className="type-dot" style={{ background: TYPE_COLOR[t] }} /> {TYPE_SHORT[t]}</span>)}</div>
        ) : (
          <div><span>0 <i className="atlas-ramp" /> 100</span><span><i className="type-dot" style={{ background: ramp(undefined) }} /> unbekannt</span></div>
        )}
        <div className="muted">Nah beieinander = ähnliches Profil · die Achsen haben keine Bedeutung · {shown.length} Lokale</div>
      </div>
      {view.k > 1 && (
        <button type="button" className="ghost atlas-reset" onClick={() => setView({ x: 0, y: 0, k: 1 })}>Ansicht zurücksetzen</button>
      )}
    </div>
  )
}

export { ramp as atlasRamp }
