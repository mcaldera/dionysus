import { useEffect, useRef, useState } from 'react'
import { clock, duration } from '../domain/hours'
import type { SwapOption } from '../domain/solver'
import type { SlotView } from '../domain/tour'
import { googleMapsDirections, legLabel } from '../domain/travel'
import type { TransitRoute } from '../routes'
import { TYPE_COLOR } from '../theme'
import Icon, { ModeIcon, TypeIcon } from './Icon'
import { TypePill } from './BarFacts'

interface Props {
  slots: SlotView[]
  districtCount: number
  districtName: (d: number) => string
  pinned: Set<string>
  /** Transit route per slot (the leg into it), when known. */
  routes: (TransitRoute | null | undefined)[]
  swap: { index: number; options: SwapOption[] } | null
  selectedId: string | null
  busy: string | null
  onSelect: (id: string) => void
  /** Delete the slot; later stops move up. */
  onRemove: (index: number) => void
  /** Empty the slot but keep its place. */
  onClear: (index: number) => void
  onTogglePin: (id: string) => void
  onSwap: (index: number | null) => void
  onPickSwap: (id: string) => void
  onHoverSwap: (id: string | null) => void
  onMove: (from: number, to: number) => void
  onFinish: () => void
  onOptimize: () => void
  onClearAll: () => void
}

function minutes(d: number): string {
  const r = Math.round(d)
  return r === 0 ? '±0 Min.' : `${r > 0 ? '+' : '−'}${Math.abs(r)} Min.`
}

function rides(r: TransitRoute | null | undefined) {
  return r ? r.segments.filter((s) => s.kind === 'ride') : []
}

export default function TourPanel(p: Props) {
  const { slots, districtCount } = p
  const filled = slots.filter((s) => s.stop)
  const empty = slots.length - filled.length
  const first = filled[0]?.stop
  const last = filled[filled.length - 1]?.stop
  const total = first && last ? last.departure - first.arrival : 0
  const pct = Math.round((filled.length / districtCount) * 100)
  const pinnedCount = filled.filter((s) => p.pinned.has(s.stop!.bar.id)).length
  const [drag, setDrag] = useState<number | null>(null)
  const [over, setOver] = useState<number | null>(null)
  const selectedRow = useRef<HTMLLIElement>(null)

  // A bar picked on the map: bring its row into view.
  useEffect(() => {
    selectedRow.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [p.selectedId])

  return (
    <section className="card" aria-label="Eure Tour">
      <div className="card-head">
        <h3>Eure Tour</h3>
        {slots.length > 0 && (
          <span className="totals">
            {filled.length} von {districtCount} Bezirken{empty ? ` · ${empty} offen` : ''} · {empty ? '≈ ' : ''}{duration(total)}
          </span>
        )}
      </div>
      <div className="progress" aria-hidden="true"><span style={{ width: `${pct}%` }} /></div>
      {slots.length === 0 ? (
        <p className="hint">Noch keine Lokale. Wählt eines aus und klickt „Zur Tour hinzufügen“, oder plant oben mit „Tour planen“.</p>
      ) : (
        <>
          <div className="tour-actions">
            {(filled.length < districtCount || empty > 0) && (
              <button type="button" className="primary small-btn" disabled={!!p.busy} onClick={p.onFinish}
                title="Behält die Reihenfolge, füllt leere Plätze und plant fehlende Bezirke dazu">
                <Icon name="sparkles" size={14} /> Tour fertig planen
              </button>
            )}
            <button type="button" className="ghost small" disabled={!!p.busy} onClick={p.onOptimize}
              title="Fixierte Lokale bleiben, alle anderen und die Reihenfolge werden neu gewählt. Ein fixiertes erstes Lokal bleibt der Start.">
              <Icon name="rotate" size={14} /> Optimieren{pinnedCount ? ` · ${pinnedCount} fixiert` : ''}
            </button>
            <button type="button" className="ghost small" disabled={!!p.busy} onClick={p.onClearAll}>Alles löschen</button>
          </div>
          {p.busy && <p className="hint"><span className="spinner small-spin" /> {p.busy}</p>}
          <ol className="timeline">
            {slots.map((sl, i) => {
              const s = sl.stop
              const route = p.routes[i]
              const swapping = p.swap?.index === i
              const isPinned = !!s && p.pinned.has(s.bar.id)
              const selected = !!s && s.bar.id === p.selectedId
              // Real line data: the same line out of this stop as into it.
              const back = s && rides(route).length && rides(p.routes[i + 1]).length
                && rides(route).at(-1)!.line === rides(p.routes[i + 1])[0].line
              const cls = [swapping && 'swapping', selected && 'selected', drag === i && 'dragging',
                over === i && drag !== null && drag !== i && (drag < i ? 'drop-after' : 'drop-before'), !s && 'empty-slot']
                .filter(Boolean).join(' ')
              return (
                <li key={s ? s.bar.id : `empty-${sl.district}`} className={cls || undefined} ref={selected ? selectedRow : undefined}
                  draggable onDragStart={(e) => { setDrag(i); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)) }}
                  onDragOver={(e) => { e.preventDefault(); setOver(i) }}
                  onDragLeave={() => setOver((o) => (o === i ? null : o))}
                  onDrop={(e) => {
                    e.preventDefault()
                    const from = drag ?? Number(e.dataTransfer.getData('text/plain'))
                    if (!Number.isNaN(from) && from !== i) p.onMove(from, i)
                    setDrag(null)
                    setOver(null)
                  }}
                  onDragEnd={() => { setDrag(null); setOver(null) }}>
                  {s && s.legIn && !sl.afterGap && (
                    <div className={`leg ${s.legIn.mode}`}>
                      <span>
                        <ModeIcon mode={s.legIn.mode} size={13} />{' '}
                        {route?.lines.length ? <><LineBadges route={route} /> · </> : null}
                        {legLabel(s.legIn)}
                        {route?.alternatives.length ? (
                          <span className="alt-lines" title="Je nach Abfahrt gibt es andere, ähnlich schnelle Verbindungen">
                            {' '}oder {route.alternatives.map((a) => a.join(' → ')).join(', ')}
                          </span>
                        ) : null}
                      </span>
                      <a href={googleMapsDirections(slots[i - 1].stop!.bar, s.bar, s.legIn)} target="_blank" rel="noreferrer">Route <Icon name="arrow-up-right" size={12} /></a>
                    </div>
                  )}
                  {i > 0 && s && sl.afterGap && <div className="leg gap"><span>┊ Weg hängt vom offenen Bezirk ab</span></div>}
                  <div className="stop">
                    <span className="grip" title="Ziehen zum Verschieben"><Icon name="grip" size={14} /></span>
                    <span className="time">{s ? `${sl.approx ? '≈' : ''}${clock(s.arrival)}` : '–'}</span>
                    {s ? (
                      <>
                        <span className="stop-dot" style={{ background: TYPE_COLOR[s.bar.venueType] }}>{i + 1}</span>
                        <button type="button" className="link stop-name" onClick={() => p.onSelect(s.bar.id)}>
                          {s.bar.name} <span className="muted"><TypeIcon type={s.bar.venueType} /> {s.bar.district}.</span>
                        </button>
                        <button type="button" className={`icon-btn pin${isPinned ? ' on' : ''}`} aria-pressed={isPinned}
                          aria-label={`${s.bar.name} fixieren`} title={isPinned ? 'Fixiert: bleibt beim Optimieren' : 'Fixieren: bleibt beim Optimieren'}
                          onClick={() => p.onTogglePin(s.bar.id)}><Icon name="pushpin" size={15} filled={isPinned} /></button>
                        <button type="button" className={`icon-btn${swapping ? ' on' : ''}`} aria-label={`${s.bar.name} tauschen`}
                          title="Anderes Lokal in diesem Bezirk" onClick={() => p.onSwap(swapping ? null : i)}><Icon name="arrow-left-right" size={15} /></button>
                        <button type="button" className="icon-btn" aria-label={`${s.bar.name} leeren`}
                          title="Lokal entfernen, Platz behalten" onClick={() => p.onClear(i)}><Icon name="eraser" size={15} /></button>
                      </>
                    ) : (
                      <>
                        <span className="stop-dot hollow">{i + 1}</span>
                        <span className="stop-name empty">{p.districtName(sl.district)} <span className="muted">· offen</span></span>
                        <button type="button" className={`icon-btn${swapping ? ' on' : ''}`} aria-label={`Vorschläge für ${sl.district}. Bezirk`}
                          title="Passende Lokale für diesen Platz" onClick={() => p.onSwap(swapping ? null : i)}><Icon name="arrow-left-right" size={15} /></button>
                      </>
                    )}
                    <button type="button" className="icon-btn" aria-label={`Platz ${i + 1} löschen`}
                      title="Platz löschen; die folgenden rücken nach" onClick={() => p.onRemove(i)}><Icon name="x" size={16} /></button>
                  </div>
                  {s?.closedOnArrival && <div className="warn small stop-note"><Icon name="warn" size={13} /> Bei Ankunft geschlossen</div>}
                  {back ? <div className="warn small stop-note"><Icon name="undo" size={13} /> Gleiche Linie hin und zurück ({rides(route).at(-1)!.line})</div> : null}
                  {swapping && p.swap && (
                    <div className="swap-list">
                      <p className="hint small">{s ? `Statt ${s.bar.name}` : 'Für den offenen Platz'} im {sl.district}. Bezirk:</p>
                      {p.swap.options.length === 0 && <p className="hint">Keine passenden Lokale. Filter lockern?</p>}
                      <ol className="recs">
                        {p.swap.options.map((o, k) => (
                          <li key={o.bar.id}>
                            <button type="button" className="rec" onClick={() => p.onPickSwap(o.bar.id)}
                              onMouseEnter={() => p.onHoverSwap(o.bar.id)} onMouseLeave={() => p.onHoverSwap(null)}>
                              <span className="rank">{k + 1}</span>
                              <span className="rec-main">
                                <span className="rec-name">{o.bar.name}</span>
                                <span className="rec-meta">
                                  <TypePill bar={o.bar} />
                                  {o.closed && <span className="status closed">bei Ankunft zu</span>}
                                </span>
                              </span>
                              <span className={`leg-pill ${s && o.travelDelta <= 0 ? 'better' : ''}`}
                                title={s ? 'Wegzeit im Vergleich zum jetzigen Lokal' : 'So viel Wegzeit kommt dazu'}>
                                {minutes(o.travelDelta)}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}
                </li>
              )
            })}
          </ol>
        </>
      )}
    </section>
  )
}

function LineBadges({ route }: { route: TransitRoute }) {
  return (
    <>
      {rides(route).map((r, i) => (
        <span key={`${r.line}${i}`}>{i > 0 && ' → '}<span className="line-badge" style={{ background: r.color }}>{r.line}</span></span>
      ))}
    </>
  )
}
