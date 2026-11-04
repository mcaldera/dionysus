// Compact facts about a bar: type, district, open status, tags, tips. Shared by the
// bar panel, hover card, recommendation cards and the taste finder.

import { strongTips, tipLabel } from '../domain/filter'
import { clock, isOpenAt, openUntil } from '../domain/hours'
import { TAG_LABEL, type Bar, type Tag } from '../domain/types'
import { TYPE_COLOR, TYPE_ICON, TYPE_SHORT } from '../theme'

export function TypePill({ bar }: { bar: Bar }) {
  return (
    <span className="type-pill" style={{ '--c': TYPE_COLOR[bar.venueType] } as React.CSSProperties}>
      <span aria-hidden="true">{TYPE_ICON[bar.venueType]}</span> {TYPE_SHORT[bar.venueType]}
    </span>
  )
}

export function OpenStatus({ bar, at }: { bar: Bar; at: number | null }) {
  if (at === null) return null
  const open = isOpenAt(bar.weeklyOpen, at)
  if (open === null) return <span className="status unknown">Zeiten unbekannt</span>
  if (!open) return <span className="status closed">um {clock(at)} zu</span>
  const until = openUntil(bar.weeklyOpen, at)
  return <span className="status open">offen{until !== null ? ` bis ${clock(until)}` : ''}</span>
}

export function TagChips({ bar, highlight, max }: { bar: Bar; highlight?: Set<Tag>; max?: number }) {
  if (bar.tags.length === 0) return <span className="chip muted">noch nicht getaggt</span>
  const tags = max ? bar.tags.slice(0, max) : bar.tags
  return (
    <>
      {tags.map((t) => (
        <span key={t} className={`chip${highlight?.has(t) ? ' liked' : ''}${bar.unreviewedTags.includes(t) ? ' unreviewed' : ''}`}
          title={bar.unreviewedTags.includes(t) ? 'Noch nicht geprüft' : undefined}>
          {TAG_LABEL[t]}
        </span>
      ))}
      {max && bar.tags.length > max && <span className="chip muted">+{bar.tags.length - max}</span>}
    </>
  )
}

export function TipBadge({ bar }: { bar: Bar }) {
  const tips = strongTips(bar)
  if (!tips.length) return null
  return <span className="tip-badge" title={tips.map(tipLabel).join(', ')}>★ Tipp</span>
}
