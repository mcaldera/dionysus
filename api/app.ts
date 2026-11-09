// The site's only backend: friends' profiles, ratings, comments and lists, kept in Cloudflare D1.
// Only /api/* reaches this Worker (wrangler.jsonc), so the static site doesn't use up its quota.
//
// Anyone with the site's address can read, except private lists; writing needs a profile, and
// creating one needs the invite code. A browser holds a random token and the database only its
// hash. A personal link carries that token to another device; name and password get a new one.

import type { Comment, ListView, Me, Member, Rating, SocialState } from '../src/domain/social'

/** The parts of D1 used here, so the tests can run the same queries on plain SQLite. */
interface Statement {
  bind(...values: unknown[]): Statement
  first<T>(): Promise<T | null>
  all<T>(): Promise<{ results: T[] }>
  run(): Promise<{ meta: { changes: number } }>
}
export interface Db {
  prepare(sql: string): Statement
  batch<T>(statements: Statement[]): Promise<{ results: T[]; meta: { changes: number } }[]>
}
export interface Env {
  /** Absent in branch previews, which don't inherit production bindings. */
  DB?: Db
  INVITE_CODE?: string
}

export const LIMITS = { name: 24, passwordMin: 4, password: 100, comment: 1000, listTitle: 60, listDescription: 300, listsPerMember: 30, barsPerList: 300 }
export const LOGIN_ATTEMPTS = 10
const LOCK_MS = 15 * 60_000
// Workers' free plan allows 10 ms of CPU per request, and 10,000 rounds take about 5 ms.
const PBKDF2_ROUNDS = 10_000
const MIN_INVITE_CODE = 12
const MAX_BODY_BYTES = 64 * 1024
const RECENT_COMMENTS = 15
const BAR_ID = /^[\w:/.%-]{1,100}$/

class HttpError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function sha256(text: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
}

function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function toHex(bytes: ArrayBuffer | Uint8Array): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function derive(password: string, salt: string, rounds: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  return toHex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: rounds }, key, 256))
}

async function hashPassword(password: string): Promise<string> {
  const salt = toHex(crypto.getRandomValues(new Uint8Array(16)))
  return `pbkdf2$${PBKDF2_ROUNDS}$${salt}$${await derive(password, salt, PBKDF2_ROUNDS)}`
}

async function checkPassword(password: string, stored: string): Promise<boolean> {
  const [, rounds, salt, hash] = stored.split('$')
  return await derive(password, salt, Number(rounds)) === hash
}

function newPassword(value: unknown): string {
  const password = typeof value === 'string' ? value.trim() : ''
  if (password.length < LIMITS.passwordMin) throw new HttpError(400, `Das Passwort braucht mindestens ${LIMITS.passwordMin} Zeichen.`)
  if (password.length > LIMITS.password) throw new HttpError(400, 'Das Passwort ist zu lang.')
  return password
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text()
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) throw new HttpError(413, 'Das ist zu viel Text.')
  try {
    const body: unknown = JSON.parse(text)
    if (body && typeof body === 'object' && !Array.isArray(body)) return body as Record<string, unknown>
  } catch { /* answered below */ }
  throw new HttpError(400, 'Ungültige Anfrage.')
}

/** Single spaces, no line breaks: for names and titles. */
function cleanLine(value: unknown, what: string, max: number, min = 1): string {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
  if (text.length < min) throw new HttpError(400, `${what} fehlt oder ist zu kurz.`)
  if (text.length > max) throw new HttpError(400, `${what} ist zu lang (höchstens ${max} Zeichen).`)
  return text
}

function barId(value: unknown): string {
  if (typeof value !== 'string' || !BAR_ID.test(value)) throw new HttpError(400, 'Unbekanntes Lokal.')
  return value
}

async function memberFrom(request: Request, db: Db): Promise<Me | null> {
  const token = /^Bearer (.+)$/.exec(request.headers.get('authorization') ?? '')?.[1]
  if (!token) return null
  const row = await db.prepare(`SELECT id, name, password_hash IS NOT NULL AS hasPassword FROM members
                                WHERE token_hash = ?1 OR id = (SELECT member_id FROM sessions WHERE token_hash = ?1)`)
    .bind(await sha256(token)).first<Member & { hasPassword: number }>()
  return row && { id: row.id, name: row.name, hasPassword: !!row.hasPassword }
}

function barIds(value: unknown): string[] {
  if (!Array.isArray(value)) throw new HttpError(400, 'Ungültige Anfrage.')
  return [...new Set(value.map(barId))]
}

async function requireMember(request: Request, db: Db): Promise<Member> {
  const member = await memberFrom(request, db)
  if (!member) throw new HttpError(401, 'Bitte zuerst mitmachen.')
  return member
}

async function join(request: Request, db: Db, env: Env) {
  const expected = env.INVITE_CODE?.trim() ?? ''
  if (expected.length < MIN_INVITE_CODE) throw new HttpError(503, 'Der Einladungscode ist noch nicht eingerichtet.')
  const body = await readBody(request)
  // Comparing hashes keeps the comparison independent of how much of the code is right.
  const code = typeof body.code === 'string' ? body.code.trim() : ''
  if (await sha256(code) !== await sha256(expected)) throw new HttpError(403, 'Dieser Einladungscode stimmt nicht.')
  const name = cleanLine(body.name, 'Der Name', LIMITS.name, 2)
  const passwordHash = await hashPassword(newPassword(body.password))

  const member: Member = { id: crypto.randomUUID(), name }
  const token = newToken()
  const now = Date.now()
  const [inserted] = await db.batch([
    db.prepare('INSERT INTO members (id, name, token_hash, password_hash, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (name) DO NOTHING')
      .bind(member.id, name, await sha256(token), passwordHash, now),
    // The list behind the heart ("Meine Lokale"). Hearts were private before this list existed,
    // so it stays private until its owner decides otherwise.
    db.prepare(`INSERT INTO lists (id, owner_id, title, is_public, is_main, created_at, updated_at)
                SELECT ?, ?, ?, 0, 1, ?, ? WHERE EXISTS (SELECT 1 FROM members WHERE id = ?)`)
      .bind(crypto.randomUUID(), member.id, `Favoriten von ${name}`, now, now, member.id),
  ])
  if (!inserted.meta.changes) throw new HttpError(409, 'Dieser Name ist schon vergeben.')
  return { token, member }
}

async function login(request: Request, db: Db) {
  const body = await readBody(request)
  const name = typeof body.name === 'string' ? body.name.replace(/\s+/g, ' ').trim() : ''
  const password = typeof body.password === 'string' ? body.password.trim().slice(0, LIMITS.password) : ''
  const row = await db.prepare(`SELECT id, name, password_hash AS passwordHash, locked_until AS lockedUntil FROM members WHERE name = ?`)
    .bind(name).first<Member & { passwordHash: string | null; lockedUntil: number }>()
  const now = Date.now()
  if (row && row.lockedUntil > now) throw new HttpError(429, 'Zu viele Fehlversuche. Bitte in 15 Minuten nochmal probieren.')
  if (!row?.passwordHash || !await checkPassword(password, row.passwordHash)) {
    // An easy password is only safe as long as nobody can try thousands of them.
    if (row) {
      await db.prepare(`UPDATE members SET
                          locked_until = CASE WHEN login_failures + 1 >= ?1 THEN ?2 ELSE locked_until END,
                          login_failures = CASE WHEN login_failures + 1 >= ?1 THEN 0 ELSE login_failures + 1 END
                        WHERE id = ?3`).bind(LOGIN_ATTEMPTS, now + LOCK_MS, row.id).run()
    }
    throw new HttpError(403, 'Name oder Passwort stimmt nicht.')
  }
  const token = newToken()
  await db.batch([
    db.prepare('INSERT INTO sessions (token_hash, member_id, created_at) VALUES (?, ?, ?)').bind(await sha256(token), row.id, now),
    db.prepare('UPDATE members SET login_failures = 0, locked_until = 0 WHERE id = ?').bind(row.id),
  ])
  return { token, member: { id: row.id, name: row.name } }
}

async function setPassword(request: Request, db: Db) {
  const me = await requireMember(request, db)
  const body = await readBody(request)
  await db.prepare('UPDATE members SET password_hash = ?, login_failures = 0, locked_until = 0 WHERE id = ?')
    .bind(await hashPassword(newPassword(body.password)), me.id).run()
  return { ok: true }
}

async function state(request: Request, db: Db): Promise<SocialState> {
  const me = await memberFrom(request, db)
  // Everyone sees public lists; private ones only their owner.
  const viewer = me?.id ?? ''
  const [members, ratings, counts, lists, items, recent] = await db.batch<unknown>([
    db.prepare('SELECT id, name FROM members ORDER BY name'),
    db.prepare('SELECT bar_id AS barId, member_id AS memberId, stars, updated_at AS at FROM ratings'),
    db.prepare('SELECT bar_id AS barId, COUNT(*) AS n FROM comments GROUP BY bar_id'),
    db.prepare(`SELECT id, owner_id AS ownerId, title, description, updated_at AS updatedAt, is_public AS isPublic, is_main AS isMain
                FROM lists WHERE is_public = 1 OR owner_id = ? ORDER BY updated_at DESC`).bind(viewer),
    db.prepare(`SELECT i.list_id AS listId, i.bar_id AS barId FROM list_items i JOIN lists l ON l.id = i.list_id
                WHERE l.is_public = 1 OR l.owner_id = ? ORDER BY i.added_at, i.bar_id`).bind(viewer),
    db.prepare(`SELECT id, bar_id AS barId, member_id AS memberId, body, created_at AS at
                FROM comments ORDER BY created_at DESC LIMIT ?`).bind(RECENT_COMMENTS),
  ])
  const barsOf = new Map<string, string[]>()
  for (const { listId, barId: bar } of items.results as { listId: string; barId: string }[]) {
    barsOf.set(listId, [...(barsOf.get(listId) ?? []), bar])
  }
  return {
    me,
    members: members.results as Member[],
    ratings: ratings.results as Rating[],
    commentCounts: Object.fromEntries((counts.results as { barId: string; n: number }[]).map((c) => [c.barId, c.n])),
    lists: (lists.results as (Omit<ListView, 'barIds' | 'isPublic' | 'isMain'> & { isPublic: number; isMain: number })[])
      .map((l) => ({ ...l, isPublic: !!l.isPublic, isMain: !!l.isMain, barIds: barsOf.get(l.id) ?? [] })),
    recentComments: recent.results as Comment[],
  }
}

async function rate(request: Request, db: Db) {
  const me = await requireMember(request, db)
  const body = await readBody(request)
  const bar = barId(body.barId)
  if (body.stars === null) {
    await db.prepare('DELETE FROM ratings WHERE bar_id = ? AND member_id = ?').bind(bar, me.id).run()
    return { ok: true }
  }
  const stars = body.stars
  if (typeof stars !== 'number' || !Number.isInteger(stars) || stars < 1 || stars > 5) throw new HttpError(400, 'Bitte 1 bis 5 Sterne.')
  await db.prepare(`INSERT INTO ratings (bar_id, member_id, stars, updated_at) VALUES (?, ?, ?, ?)
                    ON CONFLICT (bar_id, member_id) DO UPDATE SET stars = excluded.stars, updated_at = excluded.updated_at`)
    .bind(bar, me.id, stars, Date.now()).run()
  return { ok: true }
}

async function listComments(url: URL, db: Db): Promise<Comment[]> {
  const { results } = await db.prepare(`SELECT id, bar_id AS barId, member_id AS memberId, body, created_at AS at
                                        FROM comments WHERE bar_id = ? ORDER BY created_at DESC`)
    .bind(barId(url.searchParams.get('bar'))).all<Comment>()
  return results
}

async function addComment(request: Request, db: Db): Promise<Comment> {
  const me = await requireMember(request, db)
  const body = await readBody(request)
  const text = typeof body.body === 'string' ? body.body.trim() : ''
  if (!text) throw new HttpError(400, 'Der Kommentar ist leer.')
  if (text.length > LIMITS.comment) throw new HttpError(400, `Der Kommentar ist zu lang (höchstens ${LIMITS.comment} Zeichen).`)
  const comment: Comment = { id: crypto.randomUUID(), barId: barId(body.barId), memberId: me.id, body: text, at: Date.now() }
  await db.prepare('INSERT INTO comments (id, bar_id, member_id, body, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(comment.id, comment.barId, comment.memberId, comment.body, comment.at).run()
  return comment
}

async function deleteComment(request: Request, db: Db, id: string) {
  const me = await requireMember(request, db)
  const { meta } = await db.prepare('DELETE FROM comments WHERE id = ? AND member_id = ?').bind(id, me.id).run()
  if (!meta.changes) throw new HttpError(404, 'Diesen Kommentar kannst du nicht löschen.')
  return { ok: true }
}

async function createList(request: Request, db: Db) {
  const me = await requireMember(request, db)
  const body = await readBody(request)
  const title = cleanLine(body.title, 'Der Titel', LIMITS.listTitle)
  const description = body.description ? cleanLine(body.description, 'Die Beschreibung', LIMITS.listDescription) : ''
  const bars = barIds(body.barIds ?? [])
  if (bars.length > LIMITS.barsPerList) throw new HttpError(400, `Eine Liste fasst höchstens ${LIMITS.barsPerList} Lokale.`)
  const owned = await db.prepare('SELECT COUNT(*) AS n FROM lists WHERE owner_id = ?').bind(me.id).first<{ n: number }>()
  if ((owned?.n ?? 0) >= LIMITS.listsPerMember) throw new HttpError(400, `Mehr als ${LIMITS.listsPerMember} Listen gehen nicht.`)
  const id = crypto.randomUUID()
  const now = Date.now()
  await db.batch([
    db.prepare('INSERT INTO lists (id, owner_id, title, description, is_public, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(id, me.id, title, description, body.isPublic === false ? 0 : 1, now, now),
    // One statement however long the list is: D1's free plan allows 50 queries per request.
    db.prepare('INSERT INTO list_items (list_id, bar_id, added_at) SELECT ?, value, ? FROM json_each(?)').bind(id, now, JSON.stringify(bars)),
  ])
  return { id }
}

async function requireOwnList(request: Request, db: Db, id: string): Promise<{ isMain: number }> {
  const me = await requireMember(request, db)
  const list = await db.prepare('SELECT owner_id AS ownerId, is_main AS isMain FROM lists WHERE id = ?').bind(id).first<{ ownerId: string; isMain: number }>()
  if (!list) throw new HttpError(404, 'Diese Liste gibt es nicht mehr.')
  if (list.ownerId !== me.id) throw new HttpError(403, 'Das ist nicht deine Liste.')
  return list
}

async function updateList(request: Request, db: Db, id: string) {
  const list = await requireOwnList(request, db, id)
  const body = await readBody(request)
  if (list.isMain && body.title !== undefined) throw new HttpError(400, '„Meine Lokale“ behält ihren Namen.')
  const title = body.title === undefined ? null : cleanLine(body.title, 'Der Titel', LIMITS.listTitle)
  const description = body.description === undefined ? null : body.description ? cleanLine(body.description, 'Die Beschreibung', LIMITS.listDescription) : ''
  const isPublic = body.isPublic === undefined ? null : body.isPublic === true ? 1 : 0
  await db.prepare(`UPDATE lists SET title = COALESCE(?, title), description = COALESCE(?, description), is_public = COALESCE(?, is_public), updated_at = ?
                    WHERE id = ?`).bind(title, description, isPublic, Date.now(), id).run()
  return { ok: true }
}

async function deleteList(request: Request, db: Db, id: string) {
  const list = await requireOwnList(request, db, id)
  if (list.isMain) throw new HttpError(400, '„Meine Lokale“ kann man nicht löschen.')
  await db.prepare('DELETE FROM lists WHERE id = ?').bind(id).run()
  return { ok: true }
}

async function setListBar(request: Request, db: Db, id: string) {
  await requireOwnList(request, db, id)
  const body = await readBody(request)
  const now = Date.now()
  if (body.on === false) {
    await db.batch([
      db.prepare('DELETE FROM list_items WHERE list_id = ? AND bar_id = ?').bind(id, barId(body.barId)),
      db.prepare('UPDATE lists SET updated_at = ? WHERE id = ?').bind(now, id),
    ])
    return { ok: true }
  }
  const adding = JSON.stringify(body.barIds === undefined ? [barId(body.barId)] : barIds(body.barIds))
  // Counts the list as it would be, so adding what is already there never fails.
  const after = await db.prepare('SELECT COUNT(*) AS n FROM (SELECT bar_id FROM list_items WHERE list_id = ? UNION SELECT value FROM json_each(?))')
    .bind(id, adding).first<{ n: number }>()
  if ((after?.n ?? 0) > LIMITS.barsPerList) throw new HttpError(400, `Eine Liste fasst höchstens ${LIMITS.barsPerList} Lokale.`)
  await db.batch([
    db.prepare('INSERT OR IGNORE INTO list_items (list_id, bar_id, added_at) SELECT ?, value, ? FROM json_each(?)').bind(id, now, adding),
    db.prepare('UPDATE lists SET updated_at = ? WHERE id = ?').bind(now, id),
  ])
  return { ok: true }
}

function route(request: Request, url: URL, db: Db, env: Env): Promise<unknown> {
  const { method } = request
  const path = url.pathname.replace(/^\/api\//, '')
  if (path === 'join' && method === 'POST') return join(request, db, env)
  if (path === 'login' && method === 'POST') return login(request, db)
  if (path === 'password' && method === 'PUT') return setPassword(request, db)
  if (path === 'state' && method === 'GET') return state(request, db)
  if (path === 'ratings' && method === 'PUT') return rate(request, db)
  if (path === 'comments' && method === 'GET') return listComments(url, db)
  if (path === 'comments' && method === 'POST') return addComment(request, db)
  if (path === 'lists' && method === 'POST') return createList(request, db)

  const comment = /^comments\/([\w-]+)$/.exec(path)
  if (comment && method === 'DELETE') return deleteComment(request, db, comment[1])
  const list = /^lists\/([\w-]+)$/.exec(path)
  if (list && method === 'PATCH') return updateList(request, db, list[1])
  if (list && method === 'DELETE') return deleteList(request, db, list[1])
  const listBars = /^lists\/([\w-]+)\/bars$/.exec(path)
  if (listBars && method === 'PUT') return setListBar(request, db, listBars[1])
  throw new HttpError(404, 'Nicht gefunden.')
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } })
}

export async function handle(request: Request, env: Env): Promise<Response> {
  try {
    if (!env.DB) throw new HttpError(503, 'Keine Datenbank angebunden.')
    return json(await route(request, new URL(request.url), env.DB, env))
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status)
    console.error(e)
    // The one failure to expect while setting up: the database exists but is still empty.
    const empty = e instanceof Error && e.message.includes('no such table')
    return json({ error: empty ? 'Die Datenbank-Tabellen fehlen noch.' : 'Da ist etwas schiefgegangen.' }, empty ? 503 : 500)
  }
}
