// "Tour planen": everything the planner uses, apart from the map filter. Opened from the
// header or the start card; also the place to start a tour.

import { clock, WEEKDAYS } from '../domain/hours'
import { ALL_DISTRICTS, CHARACTER_TAGS, SCORE_TAGS, TAG_LABEL, VENUE_TYPES, type Participant, type Tag, type VenueType } from '../domain/types'
import { SCORE_HINT } from './FilterMenu'
import { TYPE_COLOR, TYPE_SHORT } from '../theme'
import Icon, { TypeIcon, type IconName } from './Icon'

export interface PlanSettings {
  weekday: number
  startMinutes: number
  stopMinutes: number
  /** Walk if at most this many minutes slower than transit (SPEC 2). */
  walkToleranceMinutes: number
  /** Districts the tour covers, sorted. */
  districts: number[]
  startDistrict: number | null
  endDistrict: number | null
  venueTypes: Set<VenueType>
  officialOnly: boolean
  /** In districts with bars from "Meine Lokale", plan only with those. */
  mineFirst: boolean
  noBacktrack: boolean
}

const WALK_MODES: [number, IconName, string, string][] = [
  [10, 'walk', 'Lieber zu Fuß', 'Gehen, solange es höchstens 10 Min. länger dauert'],
  [5, 'scale', 'Ausgewogen', 'Gehen, solange es höchstens 5 Min. länger dauert'],
  [0, 'tram', 'Am schnellsten', 'Immer das Schnellere'],
]

interface Props {
  plan: PlanSettings
  onPlan: (p: PlanSettings) => void
  group: Participant
  onGroup: (p: Participant) => void
  districtName: (d: number) => string
  /** Districts with at least one bar from "Meine Lokale". */
  mineDistricts: number
  tourEmpty: boolean
  busy: boolean
  onTaste: () => void
  onPropose: () => void
  onTemplate: () => void
  onClose: () => void
}

export default function PlanDialog(p: Props) {
  const { plan, onPlan, group, onGroup } = p

  function toggleDistrict(d: number) {
    const has = plan.districts.includes(d)
    if (has && plan.districts.length <= 2) return
    const districts = has ? plan.districts.filter((x) => x !== d) : [...plan.districts, d].sort((a, b) => a - b)
    onPlan({
      ...plan, districts,
      startDistrict: districts.includes(plan.startDistrict ?? 0) ? plan.startDistrict : null,
      endDistrict: districts.includes(plan.endDistrict ?? 0) ? plan.endDistrict : null,
    })
  }

  function toggleType(t: VenueType) {
    const next = new Set(plan.venueTypes)
    if (next.has(t) && next.size > 1) next.delete(t)
    else next.add(t)
    onPlan({ ...plan, venueTypes: next })
  }

  function cycle(tag: Tag) {
    // egal → mag → lieber nicht → egal
    const likes = group.likes.filter((t) => t !== tag)
    const avoids = group.avoids.filter((t) => t !== tag)
    if (group.likes.includes(tag)) avoids.push(tag)
    else if (!group.avoids.includes(tag)) likes.push(tag)
    onGroup({ ...group, likes, avoids })
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Tour planen"
      onClick={(e) => { if (e.target === e.currentTarget) p.onClose() }}>
      <div className="modal plan-modal">
        <button type="button" className="icon-btn modal-close" aria-label="Schließen" onClick={p.onClose}><Icon name="x" size={18} /></button>
        <h2>Tour planen</h2>
        <div className="plan-grid">
          <section>
            <h4>Wann</h4>
            <div className="field-row">
              <label>Wochentag
                <select value={plan.weekday} onChange={(e) => onPlan({ ...plan, weekday: Number(e.target.value) })}>
                  {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
                </select>
              </label>
              <label>Start
                <input type="time" value={clock(plan.startMinutes)} step={900}
                  onChange={(e) => {
                    const [h, m] = e.target.value.split(':').map(Number)
                    if (!Number.isNaN(h)) onPlan({ ...plan, startMinutes: h * 60 + (m || 0) })
                  }} />
              </label>
              <label>Aufenthalt pro Lokal
                <select value={plan.stopMinutes} onChange={(e) => onPlan({ ...plan, stopMinutes: Number(e.target.value) })}>
                  {[10, 15, 20, 30, 45, 60].map((m) => <option key={m} value={m}>{m} Min.</option>)}
                </select>
              </label>
            </div>
          </section>
          <section>
            <h4>Wege</h4>
            <div className="segmented wide" role="group" aria-label="Gehen oder Öffis">
              {WALK_MODES.map(([tol, icon, label, hint]) => (
                <button key={tol} type="button" title={hint} aria-pressed={plan.walkToleranceMinutes === tol}
                  onClick={() => onPlan({ ...plan, walkToleranceMinutes: tol })}><Icon name={icon} size={14} /> {label}</button>
              ))}
            </div>
            <label className="check">
              <input type="checkbox" checked={plan.noBacktrack} onChange={(e) => onPlan({ ...plan, noBacktrack: e.target.checked })} />
              Nicht mit den Öffis hin und gleich wieder zurück
            </label>
          </section>
          <section className="span-2">
            <h4>Bezirke ({plan.districts.length})</h4>
            <div className="district-grid">
              {ALL_DISTRICTS.map((d) => (
                <button key={d} type="button" aria-pressed={plan.districts.includes(d)} title={p.districtName(d)}
                  onClick={() => toggleDistrict(d)}>{d}</button>
              ))}
            </div>
            <div className="field-row">
              <button type="button" className="ghost small" onClick={() => onPlan({ ...plan, districts: ALL_DISTRICTS })}>Alle 23</button>
              <label>Erster Bezirk
                <select value={plan.startDistrict ?? ''}
                  onChange={(e) => onPlan({ ...plan, startDistrict: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">Vorschlagen</option>
                  {plan.districts.map((d) => <option key={d} value={d}>{p.districtName(d)}</option>)}
                </select>
              </label>
              <label>Letzter Bezirk
                <select value={plan.endDistrict ?? ''}
                  onChange={(e) => onPlan({ ...plan, endDistrict: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">Egal</option>
                  {plan.districts.map((d) => <option key={d} value={d}>{p.districtName(d)}</option>)}
                </select>
              </label>
            </div>
          </section>
          <section>
            <h4>Lokaltypen für die Planung</h4>
            <div className="chips">
              {VENUE_TYPES.map((t) => (
                <button key={t} type="button" className="type-toggle light" aria-pressed={plan.venueTypes.has(t)}
                  style={{ '--c': TYPE_COLOR[t] } as React.CSSProperties} onClick={() => toggleType(t)}>
                  <span className="dot" /> <TypeIcon type={t} /> {TYPE_SHORT[t]}
                </button>
              ))}
            </div>
            <label className="check">
              <input type="checkbox" checked={plan.officialOnly} onChange={(e) => onPlan({ ...plan, officialOnly: e.target.checked })} />
              Nur offizielle Partnerlokale
            </label>
            <label className="check">
              <input type="checkbox" checked={plan.mineFirst && p.mineDistricts > 0} disabled={p.mineDistricts === 0}
                onChange={(e) => onPlan({ ...plan, mineFirst: e.target.checked })} />
              Meine Lokale zuerst{p.mineDistricts > 0 ? ` (in ${p.mineDistricts} ${p.mineDistricts === 1 ? 'Bezirk' : 'Bezirken'} nur diese)` : ': noch keine gemerkt'}
            </label>
          </section>
          <section>
            <h4>Vorlieben</h4>
            <p className="hint small">Klicken wechselt: mag → lieber nicht → egal.</p>
            <div className="chips">
              {CHARACTER_TAGS.map((t) => <PrefChip key={t} tag={t} group={group} onCycle={cycle} />)}
            </div>
            <p className="hint small">Beliebtheit & Bewertung:</p>
            <div className="chips">
              {SCORE_TAGS.map((t) => <PrefChip key={t} tag={t} group={group} onCycle={cycle} />)}
            </div>
            {group.likedTypes?.length ? (
              <p className="hint small">Aus dem Geschmackstest: {group.likedTypes.map((t) => TYPE_SHORT[t]).join(', ')}</p>
            ) : null}
            <div className="field-row">
              <button type="button" className="ghost small" onClick={p.onTaste}><Icon name="sparkles" size={14} /> Geschmackstest</button>
              <button type="button" className="ghost small" onClick={() => onGroup({ name: group.name, likes: [], avoids: [] })}>Zurücksetzen</button>
            </div>
          </section>
        </div>
        <div className="plan-actions">
          {p.tourEmpty ? (
            <>
              <button type="button" className="primary" disabled={p.busy} onClick={p.onPropose}><Icon name="sparkles" size={15} /> Komplette Tour vorschlagen</button>
              <button type="button" className="ghost" onClick={p.onTemplate}
                title="Ein leerer Platz pro Bezirk; ihr füllt die Lokale, die ihr kennt, und lasst den Rest planen">
                <Icon name="clipboard" size={15} /> Leere Vorlage
              </button>
            </>
          ) : (
            <>
              <button type="button" className="primary" onClick={p.onClose}>Fertig</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function PrefChip({ tag, group, onCycle }: { tag: Tag; group: Participant; onCycle: (t: Tag) => void }) {
  const state = group.likes.includes(tag) ? 'like' : group.avoids.includes(tag) ? 'avoid' : 'none'
  return (
    <button type="button" className={`chip pref-${state}`} title={SCORE_HINT[tag]} onClick={() => onCycle(tag)}>
      {state === 'like' ? <Icon name="heart" size={12} filled /> : state === 'avoid' ? <Icon name="x" size={12} /> : null} {TAG_LABEL[tag]}
    </button>
  )
}
