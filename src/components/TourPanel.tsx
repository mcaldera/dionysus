import { clock, duration } from '../domain/hours'
import type { SwapOption } from '../domain/solver'
import type { TimelineStop } from '../domain/tour'
import { googleMapsDirections, legLabel } from '../domain/travel'
import type { TransitRoute } from '../routes'
import { TYPE_COLOR, TYPE_ICON } from '../theme'
import { TypePill } from './BarFacts'

interface Props {
  stops: TimelineStop[]
  districtCount: number
  pinned: Set<string>
  /** Transit route per stop index (the leg into that stop), when known. */
  routes: (TransitRoute | null | undefined)[]
  swap: { index: number; options: SwapOption[] } | null
  busy: string | null
  onSelect: (id: string) => void
  onRemove: (id: string) => void
  onTogglePin: (id: string) => void
  onSwap: (index: number | null) => void
  onPickSwap: (id: string) => void
  onHoverSwap: (id: string | null) => void
  onFinish: () => void
  onOptimize: () => void
  onClear: () => void
}

function minutes(d: number): string {
  const r = Math.round(d)
  return r === 0 ? '±0 Min.' : `${r > 0 ? '+' : '−'}${Math.abs(r)} Min.`
}

export default function TourPanel(p: Props) {
  const { stops, districtCount } = p
  const total = stops.length ? stops[stops.length - 1].departure - stops[0].arrival : 0
  const pct = Math.round((stops.length / districtCount) * 100)
  const pinnedCount = stops.filter((s) => p.pinned.has(s.bar.id)).length
  return (
    <section className="card" aria-label="Eure Tour">
      <div className="card-head">
        <h3>Eure Tour</h3>
        {stops.length > 0 && <span className="totals">{stops.length} von {districtCount} Bezirken · {duration(total)}</span>}
      </div>
      <div className="progress" aria-hidden="true"><span style={{ width: `${pct}%` }} /></div>
      {stops.length === 0 ? (
        <p className="hint">Noch keine Lokale. Wählt eines aus und klickt „Zur Tour hinzufügen“, oder lasst euch eine Tour vorschlagen.</p>
      ) : (
        <>
          <div className="tour-actions">
            {stops.length < districtCount && (
              <button type="button" className="primary small-btn" disabled={!!p.busy} onClick={p.onFinish}
                title="Behält eure Lokale in dieser Reihenfolge und plant die restlichen Bezirke dazu">
                ✨ Tour fertig planen
              </button>
            )}
            <button type="button" className="ghost small" disabled={!!p.busy} onClick={p.onOptimize}
              title="Fixierte Lokale (📌) bleiben, alle anderen und die Reihenfolge werden neu gewählt. Ein fixiertes erstes Lokal bleibt der Start.">
              ↻ Optimieren{pinnedCount ? ` (${pinnedCount} 📌)` : ''}
            </button>
            <button type="button" className="ghost small" disabled={!!p.busy} onClick={p.onClear}>Leeren</button>
          </div>
          {p.busy && <p className="hint"><span className="spinner small-spin" /> {p.busy}</p>}
          <ol className="timeline">
            {stops.map((s, i) => {
              const route = p.routes[i]
              const swapping = p.swap?.index === i
              const isPinned = p.pinned.has(s.bar.id)
              return (
                <li key={s.bar.id} className={swapping ? 'swapping' : undefined}>
                  {s.legIn && (
                    <div className={`leg ${s.legIn.mode}`}>
                      <span>
                        {s.legIn.mode === 'walk' ? '🚶' : '🚋'}{' '}
                        {route?.lines.length ? <><LineBadges route={route} /> · </> : null}
                        {legLabel(s.legIn)}
                        {route?.alternatives.length ? (
                          <span className="alt-lines" title="Je nach Abfahrt gibt es andere, ähnlich schnelle Verbindungen">
                            {' '}oder {route.alternatives.map((a) => a.join(' → ')).join(', ')}
                          </span>
                        ) : null}
                      </span>
                      <a href={googleMapsDirections(stops[i - 1].bar, s.bar, s.legIn)} target="_blank" rel="noreferrer">Route ↗</a>
                    </div>
                  )}
                  <div className="stop">
                    <span className="time">{clock(s.arrival)}</span>
                    <span className="stop-dot" style={{ background: TYPE_COLOR[s.bar.venueType] }}>{i + 1}</span>
                    <button type="button" className="link stop-name" onClick={() => p.onSelect(s.bar.id)}>
                      {s.bar.name} <span className="muted">{TYPE_ICON[s.bar.venueType]} {s.bar.district}.</span>
                    </button>
                    <button type="button" className={`icon-btn pin${isPinned ? ' on' : ''}`} aria-pressed={isPinned}
                      aria-label={`${s.bar.name} fixieren`} title={isPinned ? 'Fixiert: bleibt beim Optimieren' : 'Fixieren: bleibt beim Optimieren'}
                      onClick={() => p.onTogglePin(s.bar.id)}>📌</button>
                    <button type="button" className={`icon-btn${swapping ? ' on' : ''}`} aria-label={`${s.bar.name} tauschen`}
                      title="Anderes Lokal in diesem Bezirk" onClick={() => p.onSwap(swapping ? null : i)}>⇄</button>
                    <button type="button" className="icon-btn" aria-label={`${s.bar.name} entfernen`} onClick={() => p.onRemove(s.bar.id)}>×</button>
                  </div>
                  {s.closedOnArrival && <div className="warn small stop-note">⚠ Bei Ankunft geschlossen</div>}
                  {swapping && p.swap && (
                    <div className="swap-list">
                      <p className="hint small">
                        Statt {s.bar.name}: andere Lokale im {s.bar.district}. Bezirk, nach Weg
                        {i > 0 ? ` von ${stops[i - 1].bar.name}` : ''}{i < stops.length - 1 ? ` und zu ${stops[i + 1].bar.name}` : ''}.
                      </p>
                      {p.swap.options.length === 0 && <p className="hint">Keine anderen passenden Lokale.</p>}
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
                              <span className={`leg-pill ${o.travelDelta <= 0 ? 'better' : ''}`} title="Wegzeit im Vergleich zum jetzigen Lokal">
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
  const rides = route.segments.filter((s) => s.kind === 'ride')
  return (
    <>
      {rides.map((r, i) => (
        <span key={`${r.line}${i}`}>{i > 0 && ' → '}<span className="line-badge" style={{ background: r.color }}>{r.line}</span></span>
      ))}
    </>
  )
}
