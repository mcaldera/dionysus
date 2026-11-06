// Figures for a clicked district, in the side panel so the map stays free.

import type { DistrictStats, ScoreSummary } from '../domain/districtStats'
import { TAG_LABEL, type Bar } from '../domain/types'
import { TYPE_COLOR, TYPE_SHORT } from '../theme'
import Icon, { TypeIcon } from './Icon'

interface Props {
  name: string
  stats: DistrictStats
  /** "jetzt" or "Sa 11:00", for the open share. */
  atLabel: string
  onPick: (id: string) => void
  onClose: () => void
}

function pct(x: number): string {
  return `${Math.round(x * 100)} %`
}

export default function DistrictCard({ name, stats: s, atLabel, onPick, onClose }: Props) {
  const max = Math.max(1, ...s.byType.map((t) => t.count))
  return (
    <section className="card district-card district-float" aria-label={`Bezirk ${name}`}>
      <div className="card-head">
        <h3>{name}</h3>
        <button type="button" className="icon-btn" aria-label="Bezirk schließen" onClick={onClose}><Icon name="x" size={16} /></button>
      </div>
      <div className="stat-tiles">
        <div><strong>{s.count}</strong><span>Lokale</span></div>
        <div><strong>{s.perKm2.toFixed(s.perKm2 < 10 ? 1 : 0)}</strong><span>pro km² ({s.areaKm2.toFixed(1)} km²)</span></div>
        <div><strong>{pct(s.openShare)}</strong><span>offen {atLabel}</span></div>
        <div><strong>{s.tippedCount || '–'}</strong><span>mit Tipp</span></div>
      </div>
      <h4>Lokaltypen</h4>
      <ul className="type-bars">
        {s.byType.map((t) => (
          <li key={t.type}>
            <span className="type-bar-label"><TypeIcon type={t.type} /> {TYPE_SHORT[t.type]}</span>
            <span className="type-bar-track"><span style={{ width: `${(t.count / max) * 100}%`, background: TYPE_COLOR[t.type] }} /></span>
            <span className="type-bar-value">{t.count} <span className="muted">· {pct(t.count / s.count)}</span></span>
          </li>
        ))}
      </ul>
      {(s.popularity || s.satisfaction) && (
        <>
          <h4>Beliebtheit &amp; Bewertung</h4>
          <div className="district-scores">
            {s.popularity && <ScoreRow label="Beliebtheit" s={s.popularity}
              hint="Typisches Lokal im Bezirk: wie bekannt es ist (0–100); die Mitte ist Wien" />}
            {s.satisfaction && <ScoreRow label="Zufriedenheit" s={s.satisfaction}
              hint="Typisches Lokal im Bezirk: wie zufrieden die Gäste sind (0–100); die Mitte ist Wien" />}
          </div>
          <div className="chips">
            {s.magnets > 0 && <span className="chip">Publikumsmagnete · {s.magnets}</span>}
            {(['top_bewertet', 'geheimtipp', 'polarisiert'] as const).filter((t) => s.scoreTagCounts[t])
              .map((t) => <span key={t} className="chip">{TAG_LABEL[t]} · {s.scoreTagCounts[t]}</span>)}
          </div>
          <div className="district-tops">
            <TopList title="Am beliebtesten" bars={s.mostPopular} onPick={onPick} />
            <TopList title="Am besten bewertet" bars={s.bestRated} onPick={onPick} />
            <TopList title="Geheimtipps" bars={s.gems} onPick={onPick} />
          </div>
        </>
      )}
      <h4>Merkmale</h4>
      <div className="chips">
        {s.topTags.map(({ tag, count }) => <span key={tag} className="chip">{TAG_LABEL[tag]} · {count}</span>)}
        {s.unknownShare > 0 && <span className="chip muted">{pct(s.unknownShare)} ohne Öffnungszeiten</span>}
      </div>
      {s.tipped.length > 0 && (
        <>
          <h4>Empfohlen</h4>
          <ul className="fav-list">
            {s.tipped.map((b) => (
              <li key={b.id}><button type="button" className="link" onClick={() => onPick(b.id)}>{b.name}</button></li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

/**
 * Diverging bar: Vienna in the middle, the lowest district median at the left end and the
 * highest at the right, so small differences between districts (Zufriedenheit 68-77) show.
 */
function ScoreRow({ label, s, hint }: { label: string; s: ScoreSummary; hint: string }) {
  const diff = Math.round(s.median - s.vienna)
  const span = s.median >= s.vienna ? s.max - s.vienna : s.vienna - s.min
  const half = span > 0 ? Math.min(1, Math.abs(s.median - s.vienna) / span) * 50 : 0
  const side = s.median >= s.vienna ? 'up' : 'down'
  return (
    <div className="meter district-meter" title={`${hint}. Skala: schwächster Bezirk ${Math.round(s.min)} · Wien ${Math.round(s.vienna)} · stärkster ${Math.round(s.max)}`}>
      <span className="meter-label">{label}</span>
      <span className="meter-track diverging">
        <span className={`meter-fill ${side}`} style={side === 'up' ? { left: '50%', width: `${half}%` } : { right: '50%', width: `${half}%` }} />
        <i className="meter-ref" style={{ left: '50%' }} />
      </span>
      <span className="meter-value">
        {Math.round(s.median)} <span className={diff > 0 ? 'up' : diff < 0 ? 'down' : 'muted'}>{diff > 0 ? '+' : diff < 0 ? '−' : '±'}{Math.abs(diff)}</span>
        <span className="muted"> · Platz {s.rank}/{s.of}</span>
      </span>
    </div>
  )
}

function TopList({ title, bars, onPick }: { title: string; bars: Bar[]; onPick: (id: string) => void }) {
  if (!bars.length) return null
  return (
    <div>
      <span className="top-title">{title}</span>
      <ol>
        {bars.map((b) => <li key={b.id}><button type="button" className="link" onClick={() => onPick(b.id)}>{b.name}</button></li>)}
      </ol>
    </div>
  )
}
