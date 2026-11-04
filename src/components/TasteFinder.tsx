// "Geschmackstest": a few this-or-that questions; the answers become the group's
// preferences (tags and venue types). See domain/taste.ts.

import { useMemo, useState } from 'react'
import { preferencesFrom, QUESTIONS, type TasteAnswers } from '../domain/taste'
import { TAG_LABEL, type Participant } from '../domain/types'
import { TYPE_ICON, TYPE_SHORT } from '../theme'

interface Props {
  onDone: (p: Participant) => void
  onClose: () => void
}

export default function TasteFinder({ onDone, onClose }: Props) {
  const [answers, setAnswers] = useState<TasteAnswers>({})
  const [step, setStep] = useState(0)
  const done = step >= QUESTIONS.length
  const result = useMemo(() => preferencesFrom(answers), [answers])
  const q = QUESTIONS[step]
  const chosen = q ? answers[q.id] ?? [] : []

  function answer(picked: number[]) {
    setAnswers((cur) => ({ ...cur, [q.id]: picked }))
    setStep((s) => s + 1)
  }

  function toggle(i: number) {
    setAnswers((cur) => {
      const list = cur[q.id] ?? []
      return { ...cur, [q.id]: list.includes(i) ? list.filter((x) => x !== i) : [...list, i] }
    })
  }

  const empty = !result.likes.length && !result.avoids.length && !result.likedTypes?.length

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Geschmackstest"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal">
        <button type="button" className="icon-btn modal-close" aria-label="Schließen" onClick={onClose}>×</button>
        <h2>✨ Geschmackstest</h2>
        {!done ? (
          <>
            <p className="hint">Frage {step + 1} von {QUESTIONS.length}</p>
            <div className="progress"><span style={{ width: `${(step / QUESTIONS.length) * 100}%` }} /></div>
            <h3 className="taste-q">{q.question}</h3>
            <div className={`taste-options${q.multi ? ' multi' : ''}`}>
              {q.options.map((o, i) => (
                <button key={o.label} type="button" className="taste-option" aria-pressed={q.multi ? chosen.includes(i) : undefined}
                  onClick={() => (q.multi ? toggle(i) : answer([i]))}>
                  <span className="taste-icon" aria-hidden="true">{o.icon}</span>
                  <strong>{o.label}</strong>
                  {o.hint && <span className="muted small">{o.hint}</span>}
                </button>
              ))}
            </div>
            <div className="vote">
              <button type="button" className="ghost" disabled={step === 0} onClick={() => setStep((s) => s - 1)}>← Zurück</button>
              {q.multi
                ? <button type="button" className="primary" onClick={() => answer(chosen)}>Weiter</button>
                : <button type="button" className="ghost" onClick={() => answer([])}>Egal</button>}
            </div>
          </>
        ) : (
          <>
            <p>So plant ihr:</p>
            <ul className="taste-result">
              {result.likedTypes?.map((t) => <li key={t}>♥ {TYPE_ICON[t]} {TYPE_SHORT[t]}</li>)}
              {result.likes.map((t) => <li key={t}>♥ {TAG_LABEL[t]}</li>)}
              {result.avoids.map((t) => <li key={t} className="avoid">✕ {TAG_LABEL[t]}</li>)}
              {empty && <li>Euch ist alles recht. Dann zählt vor allem der Weg.</li>}
            </ul>
            <p className="hint">„Lieber nicht“ senkt den Rang, entfernt aber nie ein Lokal. Viele Lokale sind noch nicht getaggt; die zählen neutral.</p>
            <div className="vote">
              <button type="button" className="ghost" onClick={() => { setAnswers({}); setStep(0) }}>Nochmal</button>
              <button type="button" className="primary" onClick={() => onDone(result)}>Übernehmen</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
