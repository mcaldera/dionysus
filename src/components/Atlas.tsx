// "Atlas": every bar as a dot, placed by its profile, drawn like a map. The dots lie on a
// landmass; territories (nested clusters, named by a local LLM) tint it, with a slider from a
// few broad regions to many small ones. Layouts (t-SNE, UMAP, PCA) morph into each other, and
// a click on a bar morphs everything into a radar around it: the most similar bars closest.
// Data: public/data/atlas.json (pipeline/private/similarity.py).

import { useEffect, useMemo, useRef, useState } from 'react'
import { barTraits, LAYOUT_LABEL, OVERLAYS, overlayColor, overlayRanks, radarLayout, STYLE_SCALES, territoryColors,
  type AtlasData, type AtlasLayout, type AtlasOverlay } from '../domain/atlas'
import { VENUE_TYPES, type Bar } from '../domain/types'
import { MINE_COLOR, SELECT_COLOR, TYPE_COLOR, TYPE_SHORT } from '../theme'

interface Props {
  data: AtlasData | null
  /** Bars that pass the filters; others are hidden. */
  bars: Bar[]
  /** All bars by matrix index. */
  byIndex: Map<number, Bar>
  selectedId: string | null
  highlightId: string | null
  /** "Meine Lokale", ringed in their colour. */
  mine: Set<string>
  /** Space taken by the panel, in pixels. */
  inset: { right: number; bottom: number }
  onSelect: (id: string) => void
  onBackground: () => void
}

/** Similar bars linked in the atlas and listed in the panel. */
export const SIMILAR_SHOWN = 5
const SIZE = 1000
const MIN_ZOOM = 0.5
const MAX_ZOOM = 12
const PAD = 40
const MORPH_MS = 950
/** Rings in the radar: the n most similar bars. */
const RINGS = [10, 50, 200]
const LABEL_SIZE = [22, 17, 13.5, 11]

/** A stable pseudo-random delay per bar, so the dots fade in like a cloud forming (0-500 ms). */
const entryDelay = (i: number) => (i * 7919) % 500
const svgXY = ([x, y]: [number, number]): [number, number] => [PAD + x * (SIZE - 2 * PAD), PAD + (1 - y) * (SIZE - 2 * PAD)]

function loadLayout(): AtlasLayout {
  try {
    const v = localStorage.getItem('atlasLayout')
    return v === 'umap' || v === 'pca' ? v : 'tsne'
  } catch {
    return 'tsne'
  }
}

function loadOverlay(): AtlasOverlay {
  try {
    const v = localStorage.getItem('atlasOverlay')
    return OVERLAYS.find((o) => o.key === v)?.key ?? 'gebiete'
  } catch {
    return 'gebiete'
  }
}

export default function Atlas(p: Props) {
  const { data, bars, byIndex, selectedId, highlightId, mine, inset, onSelect, onBackground } = p
  const svg = useRef<SVGSVGElement>(null)
  const [view, setView] = useState({ x: 0, y: 0, k: 1 })
  const [layout, setLayoutState] = useState<AtlasLayout>(loadLayout)
  const [level, setLevel] = useState(2)
  const [hover, setHover] = useState<{ bar: Bar; x: number; y: number } | null>(null)
  const [hoverZone, setHoverZone] = useState<{ c: number; x: number; y: number } | null>(null)
  const [morphing, setMorphing] = useState(false)
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null)
  // The drawing fills the whole area (so it can be dragged anywhere), but its home position is the
  // part the side panel or bottom sheet leaves free.
  const [box, setBox] = useState({ w: 1000, h: 1000 })
  useEffect(() => {
    const el = svg.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [data])
  const freeW = Math.max(box.w - inset.right, box.w * 0.4)
  const freeH = Math.max(box.h - inset.bottom, box.h * 0.4)
  const fitScale = Math.max(Math.min(freeW, freeH) / SIZE, 1e-3)
  const fit = { scale: fitScale, ox: (freeW - SIZE * fitScale) / 2, oy: (freeH - SIZE * fitScale) / 2 }
  const [legendOpen, setLegendOpenState] = useState(() => {
    try { return localStorage.getItem('atlasLegend') !== 'closed' } catch { return true }
  })
  const setLegendOpen = (o: boolean) => {
    setLegendOpenState(o)
    try { localStorage.setItem('atlasLegend', o ? 'open' : 'closed') } catch { /* private mode */ }
  }

  const [overlay, setOverlayState] = useState<AtlasOverlay>(loadOverlay)
  const setOverlay = (o: AtlasOverlay) => {
    setOverlayState(o)
    try { localStorage.setItem('atlasOverlay', o) } catch { /* private mode */ }
  }
  const setLayout = (l: AtlasLayout) => {
    setLayoutState(l)
    try { localStorage.setItem('atlasLayout', l) } catch { /* private mode */ }
  }

  const atlasBars = useMemo(() => (data ? data.bars.map((i) => byIndex.get(i)) : []), [data, byIndex])
  const visible = useMemo(() => new Set(bars.map((b) => b.id)), [bars])
  const center = useMemo(() => atlasBars.findIndex((b) => b?.id === selectedId), [atlasBars, selectedId])
  const radar = useMemo(() => {
    if (!data || center < 0) return null
    const at = new Map(atlasBars.map((b, i) => [b?.matrixIndex, i]))
    const top = (atlasBars[center]?.profile?.similar ?? []).map((m) => at.get(m)).filter((i): i is number => i !== undefined)
    return radarLayout(data.layouts[layout], atlasBars, center, top)
  }, [data, layout, atlasBars, center])
  const pos = useMemo(() => (data ? (radar ? radar.pos : data.layouts[layout]).map(svgXY) : []), [data, radar, layout])
  const selected = center >= 0 ? atlasBars[center]! : null
  const missing = selectedId && data && center < 0 ? byIndex.get([...byIndex.values()].find((b) => b.id === selectedId)?.matrixIndex ?? -1) : null

  // Territories and labels fade out while the dots move, and back in at their new places.
  useEffect(() => {
    setMorphing(true)
    setView({ x: 0, y: 0, k: 1 })
    const t = setTimeout(() => setMorphing(false), MORPH_MS)
    return () => clearTimeout(t)
  }, [layout, center])

  const similar = useMemo(() => {
    if (!selected) return []
    const at = new Map(atlasBars.map((b, i) => [b?.matrixIndex, i]))
    return (selected.profile?.similar ?? []).slice(0, SIMILAR_SHOWN).map((m) => at.get(m)).filter((i): i is number => i !== undefined)
  }, [selected, atlasBars])

  const lv = data && level > 0 ? data.levels[level - 1] : null
  const colors = useMemo(() => (data && level > 0 ? territoryColors(data, level - 1) : []), [data, level])
  const ranks = useMemo(() => (data ? overlayRanks(data, atlasBars, overlay) : []), [data, atlasBars, overlay])
  const overlayInfo = OVERLAYS.find((o) => o.key === overlay)!

  // Labels at the median of each territory, biggest first, skipped where they would overlap.
  const labels = useMemo(() => {
    if (!lv || radar) return []
    const size = LABEL_SIZE[Math.min(level - 1, LABEL_SIZE.length - 1)]
    const placed: { x: number; y: number; w: number; h: number }[] = []
    const out: { c: number; x: number; y: number; size: number }[] = []
    const order = lv.clusters.map((c, i) => [c.n, i] as const).sort((a, b) => b[0] - a[0])
    for (const [, c] of order) {
      const pts = pos.filter((_, i) => lv.assign[i] === c)
      if (pts.length < 3) continue
      const med = (k: 0 | 1) => [...pts].map((q) => q[k]).sort((a, b) => a - b)[Math.floor(pts.length / 2)]
      const x = med(0)
      const y = med(1)
      // Upper case with wide spacing on the two coarse levels needs more room.
      const w = lv.clusters[c].name.length * size * (level <= 2 ? 0.78 : 0.55)
      const h = size * 1.3
      if (placed.some((q) => Math.abs(q.x - x) < (q.w + w) / 2 && Math.abs(q.y - y) < (q.h + h) / 2)) continue
      placed.push({ x, y, w, h })
      out.push({ c, x, y, size })
    }
    return out
  }, [lv, radar, pos, level])

  // The dots; memoised so hovering doesn't re-render all of them.
  const nodes = useMemo(() => atlasBars.map((b, i) => {
    if (!b) return null
    const [x, y] = pos[i]
    const shown = visible.has(b.id)
    const cls = ['atlas-node', !shown && 'hidden', mine.has(b.id) && 'mine'].filter(Boolean).join(' ')
    return (
      <g key={b.id} className={cls} data-i={i} style={{ transform: `translate(${x}px, ${y}px)` }}>
        <circle r={5.5 / Math.sqrt(view.k)} fill={TYPE_COLOR[b.venueType]} className="atlas-dot" style={{ '--d': `${entryDelay(b.matrixIndex)}ms` } as React.CSSProperties} />
      </g>
    )
  }), [atlasBars, pos, visible, mine, view.k])

  function toSvg(clientX: number, clientY: number) {
    const r = svg.current!.getBoundingClientRect()
    return { x: (clientX - r.left - fit.ox) / fit.scale, y: (clientY - r.top - fit.oy) / fit.scale, scale: fit.scale }
  }

  /** Zoom by `f` around a point in svg coordinates (default: the middle). */
  function zoomBy(f: number, q = { x: SIZE / 2, y: SIZE / 2 }) {
    setView((v) => {
      const k = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, v.k * f))
      return { k, x: q.x - ((q.x - v.x) / v.k) * k, y: q.y - ((q.y - v.y) / v.k) * k }
    })
  }

  function onWheel(e: React.WheelEvent) {
    zoomBy(Math.exp(-e.deltaY * 0.0015), toSvg(e.clientX, e.clientY))
  }

  /** Zoom to a territory (click on its name). */
  function zoomTo(c: number) {
    if (!lv) return
    const pts = pos.filter((_, i) => lv.assign[i] === c)
    const xs = pts.map((q) => q[0])
    const ys = pts.map((q) => q[1])
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
    const k = Math.max(1, Math.min(6, (SIZE * 0.8) / Math.max(x1 - x0, y1 - y0, 60)))
    setView({ k, x: SIZE / 2 - ((x0 + x1) / 2) * k, y: SIZE / 2 - ((y0 + y1) / 2) * k })
  }

  const barAt = (target: EventTarget) => {
    const el = (target as Element).closest?.('[data-i]')
    return el ? atlasBars[Number(el.getAttribute('data-i'))] ?? null : null
  }

  if (!data) {
    return (
      <div className="atlas" style={{ paddingRight: inset.right, paddingBottom: inset.bottom }}>
        <p className="atlas-empty">Der Atlas lädt …</p>
      </div>
    )
  }

  const sel = center >= 0 ? pos[center] : null
  const hi = highlightId ? atlasBars.findIndex((b) => b?.id === highlightId) : -1
  const facetsRow = center >= 0 ? data.facets.values[center] : null

  return (
    <div className={`atlas${radar ? ' radar' : ''}${morphing ? ' morphing' : ''}`}
      onMouseLeave={() => setHover(null)}>
      <svg ref={svg} viewBox={`${-fit.ox / fit.scale} ${-fit.oy / fit.scale} ${box.w / fit.scale} ${box.h / fit.scale}`}
        preserveAspectRatio="xMidYMid meet" role="img"
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
          if (d.moved) setView((v) => ({ ...v, x: d.vx + dx, y: d.vy + dy }))
        }}
        onPointerUp={(e) => {
          const d = drag.current
          drag.current = null
          if (!d || d.moved) return
          const b = barAt(e.target)
          if (b && visible.has(b.id)) onSelect(b.id)
          else if (!(e.target as Element).closest?.('.atlas-label')) onBackground()
        }}>
        <defs>
          {/* Metaballs: blur the dots' discs together, then cut the blur at a threshold. */}
          <filter id="atlas-land" filterUnits="userSpaceOnUse" x={-200} y={-200} width={SIZE + 400} height={SIZE + 400}>
            <feGaussianBlur in="SourceGraphic" stdDeviation="16" result="b" />
            <feColorMatrix in="b" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 28 -11" result="g" />
            <feDropShadow in="g" dx="0" dy="5" stdDeviation="7" floodColor="#5a4a30" floodOpacity="0.16" />
          </filter>
          <filter id="atlas-zones" filterUnits="userSpaceOnUse" x={-200} y={-200} width={SIZE + 400} height={SIZE + 400}>
            <feGaussianBlur in="SourceGraphic" stdDeviation="11" result="b" />
            <feColorMatrix in="b" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 24 -10" />
          </filter>
          <pattern id="atlas-sea" width="22" height="22" patternUnits="userSpaceOnUse" patternTransform="rotate(-20)">
            <path d="M0 11 Q 5.5 7 11 11 T 22 11" fill="none" stroke="#c9d6d8" strokeWidth="0.8" />
          </pattern>
        </defs>
        <rect x={-SIZE * 4} y={-SIZE * 4} width={SIZE * 9} height={SIZE * 9} fill="url(#atlas-sea)" opacity={0.55} />
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {!radar && (
            <g className="atlas-terrain">
              <g filter="url(#atlas-land)" fill="#f8f4ec">
                {pos.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={30} />)}
              </g>
              {overlay === 'gebiete' && lv && (
                <g filter="url(#atlas-zones)" opacity={0.75}>
                  {pos.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={20} fill={colors[lv.assign[i]]} />)}
                </g>
              )}
              {overlay !== 'gebiete' && (
                // The land coloured by the chosen value; neighbouring discs blur into a smooth surface.
                <g filter="url(#atlas-zones)" opacity={0.9} key={overlay} className="atlas-overlay">
                  {pos.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={22} fill={overlayColor(ranks[i])} />)}
                </g>
              )}
            </g>
          )}
          {radar && (
            <g className="atlas-rings">
              {RINGS.filter((n) => n < atlasBars.length).map((n) => {
                const r = radar.ringAt(n) * (SIZE - 2 * PAD)
                return (
                  <g key={n}>
                    <circle cx={SIZE / 2} cy={SIZE / 2} r={r} />
                    <text x={SIZE / 2} y={SIZE / 2 - r - 6}>{n} ähnlichste</text>
                  </g>
                )
              })}
            </g>
          )}
          {sel && similar.map((i) => (
            <line key={`${center}-${i}`} x1={sel[0]} y1={sel[1]} x2={pos[i][0]} y2={pos[i][1]} pathLength={1}
              className="atlas-link" strokeWidth={1.4 / view.k} />
          ))}
          <g className="atlas-nodes" style={{ '--k': view.k } as React.CSSProperties}
            onPointerOver={(e) => {
              const b = barAt(e.target)
              if (b && visible.has(b.id)) setHover({ bar: b, x: e.clientX, y: e.clientY })
            }}
            onPointerOut={(e) => { if (barAt(e.target)) setHover(null) }}>
            {nodes}
          </g>
          {similar.map((i, k) => (
            <g key={`${center}-${i}`} pointerEvents="none" className="atlas-node-mark" style={{ transform: `translate(${pos[i][0]}px, ${pos[i][1]}px)` }}>
              <circle r={8.5} className="atlas-ring" strokeWidth={2 / view.k} />
              <text x={12} y={5} className="atlas-rank" fontSize={20 / Math.sqrt(view.k)}>{k + 1}</text>
            </g>
          ))}
          {[center, hi].map((i, k) => (i < 0 ? null : (
            <g key={`${k}-${i}`} pointerEvents="none" className="atlas-node-mark" style={{ transform: `translate(${pos[i][0]}px, ${pos[i][1]}px)` }}>
              {k === 0 && <circle r={10.5} className="atlas-pulse" fill="none" stroke="#121110" strokeWidth={1.5 / view.k} />}
              <circle r={10.5} fill={SELECT_COLOR} className="atlas-selected" strokeWidth={2.2 / view.k} />
            </g>
          )))}
          {labels.map(({ c, x, y, size }) => (
            <text key={`${level}-${c}`} x={x} y={y} className={`atlas-label l${level}`} fontSize={size / Math.sqrt(view.k)}
              onPointerEnter={(e) => setHoverZone({ c, x: e.clientX, y: e.clientY })}
              onPointerLeave={() => setHoverZone(null)}
              onClick={() => zoomTo(c)}>
              {lv!.clusters[c].name}
            </text>
          ))}
        </g>
      </svg>

      {hover && <HoverCard bar={hover.bar} x={hover.x} y={hover.y} right={inset.right} zone={lv ? lv.clusters[lv.assign[atlasBars.indexOf(hover.bar)]]?.name : undefined} />}
      {hoverZone && lv && (
        <div className="hover-card" style={{ position: 'fixed', left: hoverZone.x + 14, top: hoverZone.y + 12 }}>
          <strong>{lv.clusters[hoverZone.c].name}</strong> <span className="muted">· {lv.clusters[hoverZone.c].n} Lokale</span>
          <div className="atlas-keywords">{lv.clusters[hoverZone.c].desc}</div>
          {lv.clusters[hoverZone.c].traits.length > 0 && <div className="atlas-traits">{lv.clusters[hoverZone.c].traits.join(' · ')}</div>}
          <div className="muted small">Klick zoomt hin</div>
        </div>
      )}

      {selected && facetsRow && (
        <FocusCard bar={selected} data={data} index={center} row={facetsRow} />
      )}
      {missing && <div className="atlas-toast">Für {missing.name} gibt es noch kein Profil, deshalb fehlt es im Atlas.</div>}

      <div className={`map-legend atlas-legend${legendOpen ? '' : ' closed'}`} aria-label="Legende">
        <button type="button" className="atlas-legend-toggle" aria-expanded={legendOpen} onClick={() => setLegendOpen(!legendOpen)}
          aria-label={legendOpen ? 'Legende einklappen' : 'Legende ausklappen'}>
          <span>Legende</span><span aria-hidden="true">{legendOpen ? '▾' : '▸'}</span>
        </button>
        {legendOpen && <>
        <div className="atlas-controls">
          <span className="muted">Anordnung</span>
          <div className="segmented small" role="group" aria-label="Anordnung">
            {(Object.keys(LAYOUT_LABEL) as AtlasLayout[]).map((l) => (
              <button key={l} type="button" aria-pressed={layout === l} title={LAYOUT_LABEL[l].hint} onClick={() => setLayout(l)}>{LAYOUT_LABEL[l].label}</button>
            ))}
          </div>
        </div>
        <label className="atlas-controls atlas-slider">
          <span className="muted">Gebiete</span>
          <input type="range" min={0} max={data.levels.length} step={1} value={level} disabled={!!radar}
            onChange={(e) => setLevel(Number(e.target.value))} aria-label="Wie fein die Gebiete sind" />
          <span className="muted mono">{level === 0 ? 'aus' : data.levels[level - 1].clusters.length}</span>
        </label>
        <label className="atlas-controls">
          <span className="muted">Einfärben</span>
          <select value={overlay} onChange={(e) => setOverlay(e.target.value as AtlasOverlay)} aria-label="Land einfärben nach">
            {OVERLAYS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
        </label>
        {overlayInfo.low && (
          <div className="atlas-gradient">
            <span>{overlayInfo.low}</span><i style={{ background: `linear-gradient(90deg, ${[0, 0.25, 0.5, 0.75, 1].map(overlayColor).join(', ')})` }} /><span>{overlayInfo.high}</span>
          </div>
        )}
        <div>{VENUE_TYPES.map((t) => <span key={t}><i className="type-dot" style={{ background: TYPE_COLOR[t] }} /> {TYPE_SHORT[t]}</span>)}</div>
        <div className="muted">
          {radar ? 'Ringe: die ähnlichsten Lokale zuerst · Klick ins Leere kehrt zurück' : 'Nah beieinander = ähnliches Profil · Klick auf ein Lokal zeigt seine Nachbarn'}
          {mine.size > 0 && <> · <i className="type-dot" style={{ background: 'none', boxShadow: `0 0 0 2px ${MINE_COLOR}` }} /> Meine Lokale</>}
        </div>
        </>}
      </div>
      <div className="atlas-zoom" style={{ right: inset.right + 12 }} role="group" aria-label="Ansicht">
        <button type="button" onClick={() => zoomBy(1.4)} title="Hineinzoomen" aria-label="Hineinzoomen">+</button>
        <button type="button" onClick={() => zoomBy(1 / 1.4)} title="Herauszoomen" aria-label="Herauszoomen">−</button>
        <button type="button" onClick={() => setView({ x: 0, y: 0, k: 1 })} disabled={view.k === 1 && view.x === 0 && view.y === 0}
          title="Ansicht zurücksetzen" aria-label="Ansicht zurücksetzen">⟲</button>
      </div>
    </div>
  )
}

function HoverCard({ bar, x, y, right, zone }: { bar: Bar; x: number; y: number; right: number; zone?: string }) {
  // Flips to the left of the cursor near the panel, so it isn't hidden behind it.
  const style: React.CSSProperties = x > window.innerWidth - right - 300
    ? { position: 'fixed', right: window.innerWidth - x + 14, top: y + 12 }
    : { position: 'fixed', left: x + 14, top: y + 12 }
  return (
    <div className="hover-card" style={style}>
      <strong>{bar.name}</strong>
      <div className="rec-meta">
        <span><i className="type-dot" style={{ background: TYPE_COLOR[bar.venueType] }} /> {TYPE_SHORT[bar.venueType]}</span>
        <span> · {bar.district}. Bezirk</span>
      </div>
      {zone && <div className="atlas-traits">{zone}</div>}
      {bar.keywords && <div className="atlas-keywords">{bar.keywords.slice(0, 5).join(' · ')}</div>}
    </div>
  )
}

/** Where the chosen bar lies: its territory at each level, its style against the average, what stands out. */
function FocusCard({ bar, data, index, row }: { bar: Bar; data: AtlasData; index: number; row: (number | null)[] }) {
  const f = data.facets
  const path = data.levels.map((lv) => lv.clusters[lv.assign[index]].name)
    .filter((n, i, all) => all.indexOf(n) === i)
  const traits = barTraits(f, row)
  return (
    <section className="atlas-focus" aria-label={`Wo ${bar.name} im Atlas liegt`}>
      <h3>{bar.name}</h3>
      <p className="atlas-path">{path.map((n, i) => <span key={n}>{i > 0 && <span className="sep"> › </span>}{n}</span>)}</p>
      <div className="atlas-scales">
        {STYLE_SCALES.map((name) => {
          const j = f.names.indexOf(name)
          if (j < 0) return null
          const v = row[j]
          const at = (x: number) => `${((x - 1) / 4) * 100}%`
          return (
            <div key={name} className="atlas-scale" title={v == null ? 'Dazu sagen die Unterlagen nichts' : undefined}>
              <span className="end">{f.low[j]}</span>
              <span className="track">
                <i className="avg" style={{ left: at(f.mean[j]) }} />
                {v != null && <i className="val" style={{ left: at(v) }} />}
              </span>
              <span className="end">{f.high[j]}</span>
            </div>
          )
        })}
      </div>
      <p className="atlas-scale-key"><i className="val" /> {bar.name.length > 22 ? 'dieses Lokal' : bar.name} <i className="avg" /> Durchschnitt</p>
      {traits.length > 0 && (
        <div className="chips">{traits.map((t) => <span key={t} className="chip">{t}</span>)}</div>
      )}
    </section>
  )
}

