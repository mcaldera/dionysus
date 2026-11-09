// In the bar panel: what friends think of this bar, and your own rating, comment and lists.

import { useEffect, useState } from 'react'
import { formatStars, shortDate, type BarStats, type Comment } from '../domain/social'
import type { Bar } from '../domain/types'
import type { Social } from '../useSocial'
import Icon from './Icon'

const COMMENTS_SHOWN = 3

interface PickerProps {
  value: number
  disabled?: boolean
  onChange: (stars: number) => void
}

/** Five stars; choosing the current rating again removes it. */
function StarPicker({ value, disabled, onChange }: PickerProps) {
  return (
    <div className="star-picker" role="group" aria-label="Deine Bewertung">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" disabled={disabled} aria-pressed={value === n} aria-label={`${n} ${n === 1 ? 'Stern' : 'Sterne'}`}
          title={value === n ? 'Bewertung entfernen' : undefined} className={n <= value ? 'on' : undefined} onClick={() => onChange(value === n ? 0 : n)}>
          <Icon name="star" size={20} filled={n <= value} />
        </button>
      ))}
    </div>
  )
}

interface Props {
  bar: Bar
  social: Social
  stats: BarStats
  /** Opens the dialog where you create a profile. */
  onJoin: () => void
}

export default function BarSocial({ bar, social, stats, onJoin }: Props) {
  const state = social.state
  const [comments, setComments] = useState<Comment[]>([])
  const [showAll, setShowAll] = useState(false)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const count = stats.comments

  // Bars without comments need no request; a new count (yours or a friend's) loads them again.
  useEffect(() => {
    if (!count) {
      setComments([])
      return
    }
    let stale = false
    social.comments(bar.id).then((c) => { if (!stale) setComments(c) }, (e: Error) => { if (!stale) setError(e.message) })
    return () => { stale = true }
    // `social` changes with every state update; the bar and the count are what matter here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bar.id, count])

  if (!state) return null
  const me = state.me
  const nameOf = (id: string) => state.members.find((m) => m.id === id)?.name ?? '?'
  const myStars = stats.ratings.find((r) => r.memberId === me?.id)?.stars ?? 0
  // The main list is the heart above; here only the lists you made yourself.
  const myLists = state.lists.filter((l) => l.ownerId === me?.id && !l.isMain)
  const shown = showAll ? comments : comments.slice(0, COMMENTS_SHOWN)

  async function attempt(action: () => Promise<unknown>) {
    setError(null)
    try {
      await action()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function post(e: React.FormEvent) {
    e.preventDefault()
    if (!draft.trim() || sending) return
    setSending(true)
    await attempt(async () => {
      await social.addComment(bar.id, draft)
      setDraft('')
    })
    setSending(false)
  }

  return (
    <div className="bar-social">
      <h3>
        Freunde
        {stats.avg !== null && (
          <span className="social-avg" aria-label={`Schnitt ${formatStars(stats.avg)} von 5 Sternen, ${stats.ratings.length} Bewertungen`}>
            <Icon name="star" size={13} filled /> {formatStars(stats.avg)} <span className="muted">({stats.ratings.length})</span>
          </span>
        )}
      </h3>
      {stats.ratings.length > 0 && (
        <p className="rated-by">
          {stats.ratings.map((r) => <span key={r.memberId} className="chip">{nameOf(r.memberId)} {r.stars} ★</span>)}
        </p>
      )}
      {me ? (
        <>
          <StarPicker value={myStars} onChange={(n) => void attempt(() => social.rate(bar.id, n))} />
          {myLists.length > 0 && (
            <div className="chips list-toggles" role="group" aria-label="Auf meinen Listen">
              {myLists.map((l) => {
                const on = l.barIds.includes(bar.id)
                return (
                  <button key={l.id} type="button" className="chip toggle" aria-pressed={on}
                    onClick={() => void attempt(() => social.setListBar(l.id, bar.id, !on))}>
                    <Icon name={on ? 'check' : 'plus'} size={12} /> {l.title}
                  </button>
                )
              })}
            </div>
          )}
        </>
      ) : (
        <button type="button" className="ghost small" onClick={onJoin}>Mitmachen, um zu bewerten und zu kommentieren</button>
      )}
      {shown.length > 0 && (
        <ul className="comments">
          {shown.map((c) => (
            <li key={c.id}>
              <div className="comment-head">
                <strong>{nameOf(c.memberId)}</strong> <span className="muted small">{shortDate(c.at)}</span>
                {c.memberId === me?.id && (
                  <button type="button" className="icon-btn" aria-label="Kommentar löschen"
                    onClick={() => { if (window.confirm('Diesen Kommentar löschen?')) void attempt(() => social.deleteComment(c.id)) }}>
                    <Icon name="x" size={13} />
                  </button>
                )}
              </div>
              <p>{c.body}</p>
            </li>
          ))}
        </ul>
      )}
      {comments.length > COMMENTS_SHOWN && (
        <button type="button" className="link inline small" onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'Weniger anzeigen' : `Alle ${comments.length} Kommentare`}
        </button>
      )}
      {me && (
        <form className="comment-form" onSubmit={post}>
          <textarea aria-label="Kommentar" placeholder="Was sollten die anderen wissen?" rows={2} maxLength={1000} value={draft}
            onChange={(e) => setDraft(e.target.value)}
            // Escape closes the bar; that shouldn't throw away what you are typing.
            onKeyDown={(e) => { if (e.key === 'Escape') e.stopPropagation() }} />
          <button type="submit" className="ghost small" disabled={!draft.trim() || sending}>Kommentieren</button>
        </form>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  )
}
