// "Geschmackstest": like or dislike a handful of sample bars; the answers become
// the group's preferences (tags and venue types). See domain/taste.ts.

import { useMemo, useState } from 'react'
import { preferencesFrom, sampleBars, type Verdict } from '../domain/taste'
import { TAG_LABEL, VENUE_TYPE_LABEL, type Bar, type Participant } from '../domain/types'
import { TYPE_COLOR, TYPE_ICON, TYPE_SHORT } from '../theme'
import { TagChips, TipBadge } from './BarFacts'

const ROUNDS = 10

interface Props {
  bars: Bar[]
  onDone: (p: Participant) => void
  onClose: () => void
}

export default function TasteFinder({ bars, onDone, onClose }: Props) {
  const [seed] = useState(() => Date.now())
  const sample = useMemo(() => sampleBars(bars, ROUNDS, seed), [bars, seed])
  const [verdicts, setVerdicts] = useState<{ bar: Bar; verdict: Verdict }[]>([])
  const i = verdicts.length
  const done = i >= sample.length
  const result = useMemo(() => preferencesFrom(verdicts), [verdicts])
  const bar = sample[i]

  function vote(v: Verdict) {
    setVerdicts((cur) => [...cur, { bar, verdict: v }])
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Geschmackstest">
      <div className="modal">
        <button type="button" className="icon-btn modal-close" aria-label="Schließen" onClick={onClose}>×</button>
        <h2>✨ Geschmackstest</h2>
        {!done ? (
          <>
            <p className="hint">Wie gefällt euch dieses Lokal? {i + 1} von {sample.length}</p>
            <div className="progress"><span style={{ width: `${(i / sample.length) * 100}%` }} /></div>
            <div className="taste-card" style={{ '--c': TYPE_COLOR[bar.venueType] } as React.CSSProperties}>
              <div className="taste-hero">
                <span className="taste-icon" aria-hidden="true">{TYPE_ICON[bar.venueType]}</span>
                <div>
                  <h3>{bar.name} <TipBadge bar={bar} /></h3>
                  <p>{bar.district}. Bezirk · {VENUE_TYPE_LABEL[bar.venueType]}</p>
                </div>
              </div>
              <div className="chips"><TagChips bar={bar} /></div>
              <p className="muted small">{bar.openingHoursText ?? 'Öffnungszeiten unbekannt'}</p>
            </div>
            <div className="vote">
              <button type="button" className="vote-btn no" onClick={() => vote('dislike')}>✕ Nicht meins</button>
              <button type="button" className="ghost" onClick={() => vote('skip')}>Weiß nicht</button>
              <button type="button" className="vote-btn yes" onClick={() => vote('like')}>♥ Gefällt mir</button>
            </div>
          </>
        ) : (
          <>
            <p>So schätzen wir euren Geschmack ein:</p>
            <ul className="taste-result">
              {result.likedTypes?.map((t) => <li key={t}>♥ {TYPE_ICON[t]} {TYPE_SHORT[t]}</li>)}
              {result.likes.map((t) => <li key={t}>♥ {TAG_LABEL[t]}</li>)}
              {result.avoidedTypes?.map((t) => <li key={t} className="avoid">✕ {TYPE_ICON[t]} {TYPE_SHORT[t]}</li>)}
              {result.avoids.map((t) => <li key={t} className="avoid">✕ {TAG_LABEL[t]}</li>)}
              {!result.likes.length && !result.avoids.length && !result.likedTypes?.length && !result.avoidedTypes?.length &&
                <li>Noch kein klares Muster. Probiert es nochmal oder wählt Vorlieben selbst.</li>}
            </ul>
            <p className="hint">„Lieber nicht“ senkt den Rang, entfernt aber nie ein Lokal. Viele Lokale sind noch nicht getaggt; je mehr Tags, desto genauer.</p>
            <div className="vote">
              <button type="button" className="ghost" onClick={() => setVerdicts([])}>Nochmal</button>
              <button type="button" className="primary" onClick={() => onDone(result)}>Übernehmen</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
