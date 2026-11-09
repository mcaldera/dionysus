// "Meine Lokale": the list behind the heart, in the header in all modes. With a profile it lives
// on the server and can be shown to friends; without one it stays in this browser.

import { useState } from 'react'
import { encodeMine } from '../domain/mine'
import type { Bar } from '../domain/types'
import Icon, { TypeIcon } from './Icon'

interface Props {
  bars: Bar[]
  onlyMine: boolean
  onOnlyMine: (v: boolean) => void
  onPick: (id: string) => void
  onRemove: (id: string) => void
  /** With a profile: whether friends can see this list. */
  visibility?: { isPublic: boolean; onChange: (isPublic: boolean) => void }
}

function shareLink(ids: string[]): string {
  return `${location.origin}${location.pathname}#${encodeMine(ids)}`
}

export default function MyBars({ bars, onlyMine, onOnlyMine, onPick, onRemove, visibility }: Props) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    const url = shareLink(bars.map((b) => b.id))
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // No clipboard (insecure context, denied): let the visitor copy it by hand.
      window.prompt('Link zu euren Lokalen:', url)
    }
  }

  return (
    <details className="popover my-bars">
      <summary aria-label="Meine Lokale">
        <Icon name="heart" size={15} filled={bars.length > 0} className="heart" />
        <span className="label">Meine Lokale</span>
        {bars.length > 0 && <span className="badge-count">{bars.length}</span>}
      </summary>
      <div className="popover-body wide">
        {visibility && (
          <label className="check">
            <input type="checkbox" checked={visibility.isPublic} onChange={(e) => visibility.onChange(e.target.checked)} />
            Für Freunde sichtbar
          </label>
        )}
        {bars.length === 0 ? (
          <p className="hint">Noch keine Lokale gemerkt. Im Lokal auf <Icon name="heart" size={12} /> Merken.</p>
        ) : (
          <>
            <label className="check">
              <input type="checkbox" checked={onlyMine} onChange={(e) => onOnlyMine(e.target.checked)} />
              Nur meine Lokale auf der Karte
            </label>
            <ul className="fav-list">
              {bars.map((b) => (
                <li key={b.id}>
                  <TypeIcon type={b.venueType} />
                  <button type="button" className="link" onClick={() => onPick(b.id)}>{b.name}</button>
                  <span className="muted small">{b.district}.</span>
                  <button type="button" className="icon-btn" aria-label={`${b.name} entfernen`} onClick={() => onRemove(b.id)}>
                    <Icon name="x" size={14} />
                  </button>
                </li>
              ))}
            </ul>
            <button type="button" className="ghost small" onClick={copy}>
              <Icon name={copied ? 'check' : 'link'} size={14} /> {copied ? 'Link kopiert' : 'Link zur Liste kopieren'}
            </button>
          </>
        )}
      </div>
    </details>
  )
}

interface ImportProps {
  count: number
  known: number
  onAccept: () => void
  onDismiss: () => void
}

/** Shown when someone opens a link to a list. */
export function MineImport({ count, known, onAccept, onDismiss }: ImportProps) {
  return (
    <div className="import-banner" role="status">
      <Icon name="heart" size={15} filled className="heart" />
      <span>Geteilte Liste mit {count} {count === 1 ? 'Lokal' : 'Lokalen'}{known ? ` (${known} habt ihr schon)` : ''}</span>
      <button type="button" className="primary small-btn" onClick={onAccept}>Zu meinen Lokalen</button>
      <button type="button" className="icon-btn" aria-label="Ignorieren" onClick={onDismiss}><Icon name="x" size={16} /></button>
    </div>
  )
}
