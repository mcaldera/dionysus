import type { Preferences, Recommendation } from '../domain/recommend'
import type { Tag } from '../domain/types'
import { OpenStatus, TagChips, TipBadge, TypePill } from './BarFacts'
import { ModeIcon } from './Icon'

interface Props {
  recs: Recommendation[]
  preferences: Preferences
  departure: number | null
  /** The solver is still checking how each one fits the rest of the tour. */
  refining: boolean
  onPreferences: (p: Preferences) => void
  onPreview: (id: string) => void
  onHover: (id: string | null) => void
}

const MODES: [Preferences['similarity'], string][] = [
  ['similar', 'Ähnlich'], ['different', 'Etwas anderes'], ['ignore', 'Egal'],
]

export default function Recommendations({ recs, preferences, departure, refining, onPreferences, onPreview, onHover }: Props) {
  const liked = new Set<Tag>(preferences.participants.flatMap((p) => p.likes))
  return (
    <section className="card" aria-label="Empfohlen als Nächstes">
      <div className="card-head">
        <h3>Empfohlen als Nächstes {refining && <span className="spinner small-spin" title="Prüfe, wie gut sie in die restliche Tour passen" />}</h3>
        <div className="segmented" role="group" aria-label="Ähnlichkeit">
          {MODES.map(([mode, label]) => (
            <button key={mode} type="button" aria-pressed={preferences.similarity === mode}
              onClick={() => onPreferences({ ...preferences, similarity: mode })}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <label className="slider">
        <span>Schneller</span>
        <input type="range" min={0} max={1} step={0.05} value={preferences.speedVsMatch}
          aria-label="Schneller oder passender"
          onChange={(e) => onPreferences({ ...preferences, speedVsMatch: Number(e.target.value) })} />
        <span>Passender</span>
      </label>
      {recs.length === 0 ? (
        <p className="hint">Keine passenden Lokale. Filter lockern?</p>
      ) : (
        <ol className="recs">
          {recs.slice(0, 5).map((r, i) => (
            <li key={r.bar.id}>
              <button type="button" className="rec" onClick={() => onPreview(r.bar.id)}
                onMouseEnter={() => onHover(r.bar.id)} onMouseLeave={() => onHover(null)}>
                <span className="rank">{i + 1}</span>
                <span className="rec-main">
                  <span className="rec-title">
                    <span className="rec-name">{r.bar.name}</span>
                    <TipBadge bar={r.bar} />
                  </span>
                  <span className="rec-meta">
                    <TypePill bar={r.bar} /> <span>{r.bar.district}. Bezirk</span>
                    {departure !== null && <OpenStatus bar={r.bar} at={departure + (r.leg.mode === 'unreachable' ? 0 : r.leg.minutes)} />}
                    {r.tourExtra !== undefined && (
                      <span className={`fit${r.tourExtra <= 2 ? ' good' : ''}`} title="So viel länger wird die beste restliche Tour, wenn ihr hierher geht">
                        Tour {r.tourExtra <= 0.5 ? '±0' : `+${Math.round(r.tourExtra)}`} Min.
                      </span>
                    )}
                  </span>
                  <span className="chips"><TagChips bar={r.bar} highlight={liked} max={4} /></span>
                </span>
                <span className={`leg-pill ${r.leg.mode}`}>
                  <ModeIcon mode={r.leg.mode} size={13} /> {r.leg.mode === 'unreachable' ? '–' : r.leg.minutes}<small>min</small>
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
