// "Freunde": recommendations from friends' ratings, rankings, lists, what's new, your profile.

import { useMemo, useState } from 'react'
import {
  formatStars, groupRanking, listLabel, memberRanking, recentActivity, recommendForMe, shortDate, tasteMatches, type BarStats, type ListView, type SocialState,
} from '../domain/social'
import type { Bar } from '../domain/types'
import { TYPE_COLOR } from '../theme'
import type { Social } from '../useSocial'
import Icon from './Icon'

export type FriendsTab = 'foryou' | 'top' | 'lists' | 'feed' | 'profile'
export interface FriendsView { tab: FriendsTab; listId?: string }

interface Props {
  social: Social
  state: SocialState
  bars: Bar[]
  byId: Map<string, Bar>
  index: Map<string, BarStats>
  /** "Meine Lokale", to start a list from. */
  mine: string[]
  initial: FriendsView
  onPick: (id: string) => void
  /** Filter the map down to this list. */
  onShowList: (id: string) => void
  onAdopt: (ids: string[]) => void
  onClose: () => void
}

async function copyText(text: string, label: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    window.prompt(label, text)
    return false
  }
}

function BarRow({ bar, right, sub, onPick, onRemove }: { bar: Bar; right?: React.ReactNode; sub?: string; onPick: (id: string) => void; onRemove?: () => void }) {
  return (
    <li>
      <button type="button" className="bar-row" onClick={() => onPick(bar.id)}>
        <i className="type-dot" style={{ background: TYPE_COLOR[bar.venueType] }} />
        <span className="bar-row-text">
          <span className="bar-row-name">{bar.name} <span className="muted small">{bar.district}.</span></span>
          {sub && <span className="muted small bar-row-sub">{sub}</span>}
        </span>
        {right && <span className="bar-row-right">{right}</span>}
      </button>
      {onRemove && <button type="button" className="icon-btn" aria-label={`${bar.name} entfernen`} onClick={onRemove}><Icon name="x" size={14} /></button>}
    </li>
  )
}

function Rating({ value, count }: { value: number; count?: number }) {
  return <><Icon name="star" size={12} filled /> {count === undefined ? value : formatStars(value)}{count !== undefined && <span className="muted"> ({count})</span>}</>
}

export default function FriendsDialog({ social, state, bars, byId, index, mine, initial, onPick, onShowList, onAdopt, onClose }: Props) {
  const [tab, setTab] = useState<FriendsTab>(initial.tab)
  const [listId, setListId] = useState<string | null>(initial.listId ?? null)
  const [error, setError] = useState<string | null>(null)
  const me = state.me
  const nameOf = (id: string) => state.members.find((m) => m.id === id)?.name ?? '?'

  async function attempt(action: () => Promise<unknown>): Promise<boolean> {
    setError(null)
    try {
      await action()
      return true
    } catch (e) {
      setError((e as Error).message)
      return false
    }
  }

  const tabs: [FriendsTab, string][] = [['foryou', 'Für dich'], ['top', 'Bestenliste'], ['lists', 'Listen'], ['feed', 'Neu'], ['profile', me ? 'Profil' : 'Mitmachen']]
  const open = listId ? state.lists.find((l) => l.id === listId) ?? null : null

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Freunde" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal friends-modal">
        <button type="button" className="icon-btn modal-close" aria-label="Schließen" onClick={onClose}><Icon name="x" size={18} /></button>
        <h2>Freunde</h2>
        <div className="friends-tabs" role="tablist" aria-label="Bereich">
          {tabs.map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => { setTab(k); setListId(null); setError(null) }}>{label}</button>
          ))}
        </div>
        <div className="friends-body">
          {tab === 'foryou' && <ForYou state={state} bars={bars} onPick={onPick} onJoin={() => setTab('profile')} />}
          {tab === 'top' && <Top state={state} bars={bars} index={index} onPick={onPick} />}
          {tab === 'lists' && (open
            ? <ListDetail key={open.id} list={open} label={listLabel(open, state)} ownerName={nameOf(open.ownerId)} mineList={open.ownerId === me?.id} byId={byId} social={social} attempt={attempt}
                onBack={() => setListId(null)} onPick={onPick} onShowList={onShowList} onAdopt={onAdopt} />
            : <Lists state={state} mine={mine} nameOf={nameOf} social={social} attempt={attempt} onOpen={setListId} />)}
          {tab === 'feed' && <Feed state={state} byId={byId} nameOf={nameOf} onPick={onPick} />}
          {tab === 'profile' && <Profile social={social} state={state} attempt={attempt} onJoined={() => setTab('foryou')} />}
          {error && <p className="form-error" role="alert">{error}</p>}
        </div>
      </div>
    </div>
  )
}

function ForYou({ state, bars, onPick, onJoin }: { state: SocialState; bars: Bar[]; onPick: (id: string) => void; onJoin: () => void }) {
  const recs = useMemo(() => recommendForMe(bars, state), [bars, state])
  const twins = useMemo(() => tasteMatches(state).filter((t) => t.shared > 0), [state])
  if (!state.me) {
    return (
      <div className="friends-empty">
        <p className="hint">Bewerte Lokale, dann findet die Seite, was zu dir passt.</p>
        <button type="button" className="primary" onClick={onJoin}>Mitmachen</button>
      </div>
    )
  }
  return (
    <>
      {twins.length > 0 && (
        <section>
          <h3>Geschmack</h3>
          <div className="chips">
            {twins.map((t) => (
              <span key={t.member.id} className="chip" title={`${t.shared} gemeinsam bewertete ${t.shared === 1 ? 'Lokal' : 'Lokale'}`}>
                {t.member.name} {Math.round(t.agreement * 100)} %
              </span>
            ))}
          </div>
        </section>
      )}
      <section>
        <h3>Könnte dir gefallen</h3>
        {recs.length === 0
          ? <p className="hint">Noch nichts. Bewerte ein paar Lokale, die du kennst, dann lernt die Seite deinen Geschmack.</p>
          : <ul className="bar-rows">{recs.map((r) => <BarRow key={r.bar.id} bar={r.bar} sub={r.reason} onPick={onPick} />)}</ul>}
      </section>
    </>
  )
}

function Top({ state, bars, index, onPick }: { state: SocialState; bars: Bar[]; index: Map<string, BarStats>; onPick: (id: string) => void }) {
  const [who, setWho] = useState('')
  const rows = useMemo(() => (who ? memberRanking(bars, state, who) : groupRanking(bars, index)), [who, bars, state, index])
  return (
    <section>
      <label className="friends-select">
        <span>Von</span>
        <select aria-label="Bestenliste von" value={who} onChange={(e) => setWho(e.target.value)}>
          <option value="">allen zusammen</option>
          {state.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      </label>
      {rows.length === 0
        ? <p className="hint">Noch keine Bewertungen.</p>
        : <ol className="bar-rows">{rows.map((r) => <BarRow key={r.bar.id} bar={r.bar} onPick={onPick} right={who ? <Rating value={r.value} /> : <Rating value={r.value} count={r.count} />} />)}</ol>}
    </section>
  )
}

interface ListsProps {
  state: SocialState
  mine: string[]
  nameOf: (id: string) => string
  social: Social
  attempt: (a: () => Promise<unknown>) => Promise<boolean>
  onOpen: (id: string) => void
}

function Lists({ state, mine, nameOf, social, attempt, onOpen }: ListsProps) {
  const [title, setTitle] = useState('')
  const [useMine, setUseMine] = useState(false)
  const [isPublic, setIsPublic] = useState(true)
  // Your own lists first, starting with "Meine Lokale".
  const rank = (l: ListView) => (l.ownerId !== state.me?.id ? 2 : l.isMain ? 0 : 1)
  const lists = [...state.lists].sort((a, b) => rank(a) - rank(b))

  async function create(e: React.FormEvent) {
    e.preventDefault()
    const ok = await attempt(async () => {
      const { id } = await social.createList(title, useMine ? mine : [], isPublic)
      onOpen(id)
    })
    if (ok) setTitle('')
  }

  return (
    <>
      <section>
        {lists.length === 0 && <p className="hint">Noch keine Listen.</p>}
        <ul className="bar-rows">
          {lists.map((l) => (
            <li key={l.id}>
              <button type="button" className="bar-row" onClick={() => onOpen(l.id)}>
                <Icon name={l.isMain ? 'heart' : 'clipboard'} size={14} />
                <span className="bar-row-text">
                  <span className="bar-row-name">{listLabel(l, state)}</span>
                  <span className="muted small bar-row-sub">{l.ownerId === state.me?.id ? (l.isPublic ? 'für Freunde sichtbar' : 'privat') : `von ${nameOf(l.ownerId)}`}</span>
                </span>
                {!l.isPublic && <Icon name="lock" size={13} title="Privat" />}
                <span className="bar-row-right">{l.barIds.length}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
      {state.me && (
        <form className="list-create" onSubmit={create}>
          <h3>Neue Liste</h3>
          <input aria-label="Titel der Liste" placeholder="z. B. Beste Gastgärten" maxLength={60} value={title} onChange={(e) => setTitle(e.target.value)} />
          <label className="check"><input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} /> Für Freunde sichtbar</label>
          {mine.length > 0 && (
            <label className="check"><input type="checkbox" checked={useMine} onChange={(e) => setUseMine(e.target.checked)} /> Mit meinen {mine.length} gemerkten Lokalen starten</label>
          )}
          <button type="submit" className="ghost small" disabled={!title.trim()}>Liste anlegen</button>
        </form>
      )}
    </>
  )
}

interface DetailProps {
  list: ListView
  label: string
  ownerName: string
  mineList: boolean
  byId: Map<string, Bar>
  social: Social
  attempt: (a: () => Promise<unknown>) => Promise<boolean>
  onBack: () => void
  onPick: (id: string) => void
  onShowList: (id: string) => void
  onAdopt: (ids: string[]) => void
}

function ListDetail({ list, label, ownerName, mineList, byId, social, attempt, onBack, onPick, onShowList, onAdopt }: DetailProps) {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(list.title)
  const [description, setDescription] = useState(list.description)
  const [note, setNote] = useState<string | null>(null)
  const bars = list.barIds.flatMap((id) => byId.get(id) ?? [])

  async function save(e: React.FormEvent) {
    e.preventDefault()
    // The main list keeps its name, so only its description can change.
    if (await attempt(() => social.updateList(list.id, list.isMain ? { description } : { title, description }))) setEditing(false)
  }

  async function remove() {
    if (window.confirm(`„${list.title}“ löschen?`) && await attempt(() => social.deleteList(list.id))) onBack()
  }

  async function copyLink() {
    if (await copyText(`${location.origin}${location.pathname}#liste=${list.id}`, 'Link zur Liste:')) setNote('Link kopiert')
  }

  const emptyHint = !mineList ? 'Noch leer.' : list.isMain ? 'Noch leer. Merke dir Lokale mit dem Herz.' : 'Noch leer. Öffne ein Lokal und tippe dort auf diese Liste.'

  return (
    <section>
      <button type="button" className="link small" onClick={onBack}>← Alle Listen</button>
      {editing ? (
        <form className="list-create" onSubmit={save}>
          {!list.isMain && <input aria-label="Titel der Liste" maxLength={60} value={title} onChange={(e) => setTitle(e.target.value)} />}
          <input aria-label="Beschreibung" placeholder="Beschreibung (optional)" maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} />
          <button type="submit" className="ghost small" disabled={!title.trim()}>Speichern</button>
        </form>
      ) : (
        <>
          <h3 className="list-title">{label}</h3>
          <p className="hint">{mineList && list.isMain && list.isPublic ? `Freunde sehen sie als „${list.title}“` : `von ${ownerName}`}{list.description ? ` · ${list.description}` : ''}</p>
        </>
      )}
      {mineList && (
        <label className="check">
          <input type="checkbox" checked={list.isPublic} onChange={(e) => void attempt(() => social.updateList(list.id, { isPublic: e.target.checked }))} />
          Für Freunde sichtbar
        </label>
      )}
      {bars.length === 0
        ? <p className="hint">{emptyHint}</p>
        : <ul className="bar-rows">{bars.map((b) => <BarRow key={b.id} bar={b} onPick={onPick}
            onRemove={mineList ? () => void attempt(() => social.setListBar(list.id, b.id, false)) : undefined} />)}</ul>}
      <div className="list-actions">
        <button type="button" className="ghost small" disabled={!bars.length} onClick={() => onShowList(list.id)}><Icon name="map" size={14} /> Auf der Karte</button>
        {!(mineList && list.isMain) && (
          <button type="button" className="ghost small" disabled={!bars.length} onClick={() => { onAdopt(bars.map((b) => b.id)); setNote('Zu „Meine Lokale“ hinzugefügt') }}>
            <Icon name="heart" size={14} /> Zu meinen Lokalen
          </button>
        )}
        {list.isPublic && <button type="button" className="ghost small" onClick={copyLink}><Icon name="link" size={14} /> Link kopieren</button>}
        {mineList && !editing && <button type="button" className="ghost small" onClick={() => setEditing(true)}>Bearbeiten</button>}
        {mineList && !list.isMain && <button type="button" className="ghost small" onClick={remove}>Löschen</button>}
      </div>
      {note && <p className="hint" role="status">{note}</p>}
    </section>
  )
}

function Feed({ state, byId, nameOf, onPick }: { state: SocialState; byId: Map<string, Bar>; nameOf: (id: string) => string; onPick: (id: string) => void }) {
  const items = useMemo(() => recentActivity(state).filter((a) => byId.has(a.barId)), [state, byId])
  if (!items.length) return <p className="hint">Hier erscheint, was deine Freunde bewerten und kommentieren.</p>
  return (
    <ul className="bar-rows">
      {items.map((a) => (
        <BarRow key={`${a.kind}${a.barId}${a.memberId}${a.at}`} bar={byId.get(a.barId)!} onPick={onPick} right={<span className="muted small">{shortDate(a.at)}</span>}
          sub={a.kind === 'rating' ? `${nameOf(a.memberId)}: ${a.stars} ★` : `${nameOf(a.memberId)}: ${a.body.length > 80 ? `${a.body.slice(0, 80)} …` : a.body}`} />
      ))}
    </ul>
  )
}

type Attempt = (a: () => Promise<unknown>) => Promise<boolean>

const PASSWORD_MIN = 4

/** Not signed in: a new profile (with the invite code), or back into an existing one. */
function SignIn({ social, attempt, onDone }: { social: Social; attempt: Attempt; onDone: () => void }) {
  const [mode, setMode] = useState<'join' | 'login'>('join')
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const joining = mode === 'join'
  const ready = joining ? code.trim() && name.trim().length >= 2 && password.trim().length >= PASSWORD_MIN : name.trim() && password.trim()

  return (
    <form className="list-create" onSubmit={async (e) => {
      e.preventDefault()
      if (await attempt(() => (joining ? social.join(code, name, password) : social.login(name, password)))) onDone()
    }}>
      <div className="auth-modes" role="group" aria-label="Anmeldung">
        <button type="button" aria-pressed={joining} onClick={() => setMode('join')}>Neu hier</button>
        <button type="button" aria-pressed={!joining} onClick={() => setMode('login')}>Schon dabei</button>
      </div>
      {joining && <p className="hint">Mit dem Einladungscode legst du dein Profil an. Das Passwort darf ruhig einfach sein.</p>}
      {joining && <input aria-label="Einladungscode" placeholder="Einladungscode" autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} />}
      <input aria-label="Dein Name" placeholder="Dein Name, z. B. Flo" autoComplete="username" maxLength={24} value={name} onChange={(e) => setName(e.target.value)} />
      <input aria-label="Passwort" type="password" placeholder={joining ? `Passwort (mindestens ${PASSWORD_MIN} Zeichen)` : 'Passwort'} autoComplete={joining ? 'new-password' : 'current-password'}
        maxLength={100} value={password} onChange={(e) => setPassword(e.target.value)} />
      <button type="submit" className="primary" disabled={!ready}>{joining ? 'Mitmachen' : 'Anmelden'}</button>
    </form>
  )
}

function Profile({ social, state, attempt, onJoined }: { social: Social; state: SocialState; attempt: Attempt; onJoined: () => void }) {
  const [password, setPassword] = useState('')
  const [saved, setSaved] = useState(false)
  const [copied, setCopied] = useState(false)
  const me = state.me

  if (!me) return <SignIn social={social} attempt={attempt} onDone={onJoined} />

  async function copy() {
    if (await copyText(social.deviceLink(), 'Dein persönlicher Link:')) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  async function savePassword(e: React.FormEvent) {
    e.preventDefault()
    if (await attempt(() => social.setPassword(password))) {
      setPassword('')
      setSaved(true)
    }
  }

  return (
    <section className="profile">
      <p>Angemeldet als <strong>{me.name}</strong></p>
      <h3>Auf einem anderen Gerät</h3>
      <p className="hint">Melde dich dort mit Name und Passwort an, oder öffne deinen persönlichen Link. Der Link ist wie ein Passwort: Gib ihn nicht weiter.</p>
      <button type="button" className="ghost small" onClick={copy}><Icon name={copied ? 'check' : 'link'} size={14} /> {copied ? 'Link kopiert' : 'Persönlichen Link kopieren'}</button>
      <h3>{me.hasPassword ? 'Passwort ändern' : 'Passwort festlegen'}</h3>
      {!me.hasPassword && <p className="hint">Damit kommst du auch ohne deinen Link in dein Profil.</p>}
      <form className="password-form" onSubmit={savePassword}>
        <input aria-label="Neues Passwort" type="password" placeholder={`Mindestens ${PASSWORD_MIN} Zeichen`} autoComplete="new-password" maxLength={100} value={password}
          onChange={(e) => { setPassword(e.target.value); setSaved(false) }} />
        <button type="submit" className="ghost small" disabled={password.trim().length < PASSWORD_MIN}>Speichern</button>
      </form>
      {saved && <p className="hint" role="status">Passwort gespeichert</p>}
      <h3>Dieses Gerät</h3>
      <button type="button" className="ghost small" onClick={() => {
        const back = me.hasPassword ? 'Zurück kommst du mit Name und Passwort.' : 'Zurück kommst du nur mit deinem persönlichen Link.'
        if (window.confirm(`Auf diesem Gerät abmelden? ${back}`)) social.leave()
      }}>Abmelden</button>
    </section>
  )
}
