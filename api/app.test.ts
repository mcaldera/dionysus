import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { beforeEach, describe, expect, it } from 'vitest'
import type { SocialState } from '../src/domain/social'
import { handle, LIMITS, LOGIN_ATTEMPTS, type Db, type Env } from './app'

/** D1's interface over in-memory SQLite, running the real migration and queries. */
function testDb(): Db {
  const sqlite = new DatabaseSync(':memory:')
  for (const file of ['0001_social.sql', '0002_password_private_lists.sql']) sqlite.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'))
  const statement = (sql: string, values: never[] = []) => ({
    bind: (...v: unknown[]) => statement(sql, v as never[]),
    first: async <T,>() => (sqlite.prepare(sql).get(...values) ?? null) as T | null,
    all: async <T,>() => ({ results: sqlite.prepare(sql).all(...values) as T[] }),
    run: async () => ({ meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } }),
    exec: () => {
      const s = sqlite.prepare(sql)
      if (/^\s*(SELECT)/i.test(sql)) return { results: s.all(...values), meta: { changes: 0 } }
      return { results: [], meta: { changes: Number(s.run(...values).changes) } }
    },
  })
  return {
    prepare: (sql) => statement(sql),
    batch: async (list) => (list as unknown as ReturnType<typeof statement>[]).map((s) => s.exec()) as never,
  }
}

const CODE = 'ein-langer-einladungscode'
const PASSWORD = 'bier'
let env: Env

async function call(method: string, path: string, body?: unknown, token?: string) {
  const res = await handle(new Request(`https://x.test/api/${path}`, {
    method,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: body === undefined ? undefined : JSON.stringify(body),
  }), env)
  return { status: res.status, body: await res.json() as Record<string, never> }
}

async function joined(name: string): Promise<string> {
  const r = await call('POST', 'join', { code: CODE, name, password: PASSWORD })
  expect(r.status).toBe(200)
  return r.body.token
}

async function state(token?: string): Promise<SocialState> {
  return (await call('GET', 'state', undefined, token)).body as unknown as SocialState
}

const BAR = 'osm:node/123'

beforeEach(() => {
  env = { DB: testDb(), INVITE_CODE: CODE }
})

describe('joining', () => {
  it('needs the invite code', async () => {
    expect((await call('POST', 'join', { code: 'falsch', name: 'Flo', password: PASSWORD })).status).toBe(403)
    expect((await state()).members).toEqual([])
  })

  it('stays closed while no proper code is configured', async () => {
    env.INVITE_CODE = 'kurz'
    expect((await call('POST', 'join', { code: 'kurz', name: 'Flo', password: PASSWORD })).status).toBe(503)
    env.INVITE_CODE = undefined
    expect((await call('POST', 'join', { code: '', name: 'Flo', password: PASSWORD })).status).toBe(503)
  })

  it('gives a profile, a first list, and recognises the token', async () => {
    const token = await joined('  Flo  ')
    const s = await state(token)
    expect(s.me?.name).toBe('Flo')
    expect(s.lists.map((l) => [l.title, l.isMain, l.isPublic])).toEqual([['Favoriten von Flo', true, false]])
    expect((await state()).me).toBeNull()
    expect((await state('erfunden')).me).toBeNull()
  })

  it('refuses a name that is taken, whatever its case, and leaves no stray list', async () => {
    await joined('Flo')
    expect((await call('POST', 'join', { code: CODE, name: 'flo', password: PASSWORD })).status).toBe(409)
    expect((await state(await joined('Anna'))).members).toHaveLength(2)
    const flo = (await call('POST', 'login', { name: 'FLO', password: PASSWORD })).body.token
    expect((await state(flo)).lists.filter((l) => l.isMain)).toHaveLength(1)
  })

  it('never exposes tokens', async () => {
    const token = await joined('Flo')
    expect(JSON.stringify(await state(token))).not.toContain(token)
    expect(JSON.stringify(await state(token))).not.toContain('hash')
  })
})

describe('password', () => {
  it('is needed to join, and may be simple but not tiny', async () => {
    expect((await call('POST', 'join', { code: CODE, name: 'Flo' })).status).toBe(400)
    expect((await call('POST', 'join', { code: CODE, name: 'Flo', password: 'abc' })).status).toBe(400)
    expect((await call('POST', 'join', { code: CODE, name: 'Flo', password: 'abcd' })).status).toBe(200)
  })

  it('signs in with name and password, ignoring case and stray spaces in the name', async () => {
    const first = await joined('Flo')
    const login = await call('POST', 'login', { name: '  flo ', password: PASSWORD })
    expect(login.status).toBe(200)
    expect((await state(login.body.token)).me).toEqual({ id: expect.any(String), name: 'Flo', hasPassword: true })
    // The other device stays signed in.
    expect((await state(first)).me?.name).toBe('Flo')
    expect(login.body.token).not.toBe(first)
  })

  it('gives the same answer for a wrong password and an unknown name', async () => {
    await joined('Flo')
    const wrong = await call('POST', 'login', { name: 'Flo', password: 'falsch' })
    const unknown = await call('POST', 'login', { name: 'Niemand', password: 'falsch' })
    expect(wrong.status).toBe(403)
    expect(unknown).toEqual(wrong)
  })

  it('locks out after too many wrong tries, even with the right password, and only that name', async () => {
    await joined('Flo')
    await joined('Anna')
    for (let i = 0; i < LOGIN_ATTEMPTS; i++) expect((await call('POST', 'login', { name: 'Flo', password: 'falsch' })).status).toBe(403)
    expect((await call('POST', 'login', { name: 'Flo', password: PASSWORD })).status).toBe(429)
    expect((await call('POST', 'login', { name: 'Anna', password: PASSWORD })).status).toBe(200)
  })

  it('forgets wrong tries after a successful login', async () => {
    await joined('Flo')
    for (let i = 0; i < LOGIN_ATTEMPTS - 1; i++) await call('POST', 'login', { name: 'Flo', password: 'falsch' })
    expect((await call('POST', 'login', { name: 'Flo', password: PASSWORD })).status).toBe(200)
    expect((await call('POST', 'login', { name: 'Flo', password: 'falsch' })).status).toBe(403)
    expect((await call('POST', 'login', { name: 'Flo', password: PASSWORD })).status).toBe(200)
  })

  it('can be changed, only by the signed-in person', async () => {
    const token = await joined('Flo')
    expect((await call('PUT', 'password', { password: 'seidl' })).status).toBe(401)
    expect((await call('PUT', 'password', { password: 'seidl' }, token)).status).toBe(200)
    expect((await call('POST', 'login', { name: 'Flo', password: PASSWORD })).status).toBe(403)
    expect((await call('POST', 'login', { name: 'Flo', password: 'seidl' })).status).toBe(200)
  })

  it('is never stored or returned in the clear', async () => {
    const token = await joined('Flo')
    const text = JSON.stringify(await state(token))
    expect(text).not.toContain(PASSWORD)
    expect(text).not.toContain('pbkdf2')
  })
})

describe('ratings', () => {
  it('needs a profile', async () => {
    expect((await call('PUT', 'ratings', { barId: BAR, stars: 4 })).status).toBe(401)
  })

  it('keeps one rating per person, changeable and removable', async () => {
    const token = await joined('Flo')
    await call('PUT', 'ratings', { barId: BAR, stars: 2 }, token)
    await call('PUT', 'ratings', { barId: BAR, stars: 5 }, token)
    expect((await state()).ratings.map((r) => r.stars)).toEqual([5])
    await call('PUT', 'ratings', { barId: BAR, stars: null }, token)
    expect((await state()).ratings).toEqual([])
  })

  it.each([0, 6, 2.5, '4'])('rejects %s stars', async (stars) => {
    expect((await call('PUT', 'ratings', { barId: BAR, stars }, await joined('Flo'))).status).toBe(400)
  })
})

describe('comments', () => {
  it('are public to read, and counted per bar', async () => {
    const token = await joined('Flo')
    await call('POST', 'comments', { barId: BAR, body: ' Super Bier! ' }, token)
    const list = await call('GET', `comments?bar=${encodeURIComponent(BAR)}`)
    expect((list.body as unknown as { body: string }[]).map((c) => c.body)).toEqual(['Super Bier!'])
    const s = await state()
    expect(s.commentCounts[BAR]).toBe(1)
    expect(s.recentComments).toHaveLength(1)
  })

  it('rejects empty and overlong text', async () => {
    const token = await joined('Flo')
    expect((await call('POST', 'comments', { barId: BAR, body: '   ' }, token)).status).toBe(400)
    expect((await call('POST', 'comments', { barId: BAR, body: 'x'.repeat(LIMITS.comment + 1) }, token)).status).toBe(400)
  })

  it('can only be deleted by their author', async () => {
    const flo = await joined('Flo')
    const anna = await joined('Anna')
    const { body } = await call('POST', 'comments', { barId: BAR, body: 'Hallo' }, flo)
    expect((await call('DELETE', `comments/${body.id}`, undefined, anna)).status).toBe(404)
    expect((await state()).commentCounts[BAR]).toBe(1)
    expect((await call('DELETE', `comments/${body.id}`, undefined, flo)).status).toBe(200)
    expect((await state()).commentCounts[BAR]).toBeUndefined()
  })
})

describe('lists', () => {
  /** A public list of Flo's, the way most tests need one. */
  async function publicList(token: string): Promise<string> {
    return (await call('POST', 'lists', { title: 'Gastgärten' }, token)).body.id
  }

  it('are created with bars, without duplicates', async () => {
    const token = await joined('Flo')
    const { body } = await call('POST', 'lists', { title: 'Sommer', barIds: [BAR, BAR, 'osm:way/9'] }, token)
    expect((await state()).lists.find((l) => l.id === body.id as unknown as string)?.barIds.sort()).toEqual([BAR, 'osm:way/9'])
  })

  it('take and drop bars, and can be renamed and deleted by their owner', async () => {
    const token = await joined('Flo')
    const id = await publicList(token)
    await call('PUT', `lists/${id}/bars`, { barId: BAR }, token)
    await call('PUT', `lists/${id}/bars`, { barId: BAR }, token)
    expect((await state()).lists[0].barIds).toEqual([BAR])
    await call('PUT', `lists/${id}/bars`, { barId: BAR, on: false }, token)
    expect((await state()).lists[0].barIds).toEqual([])
    await call('PATCH', `lists/${id}`, { title: 'Neu' }, token)
    expect((await state()).lists[0].title).toBe('Neu')
    await call('DELETE', `lists/${id}`, undefined, token)
    expect((await state()).lists).toEqual([])
  })

  it('take many bars at once', async () => {
    const token = await joined('Flo')
    const id = await publicList(token)
    await call('PUT', `lists/${id}/bars`, { barIds: [BAR, 'osm:way/9', BAR] }, token)
    expect((await state()).lists[0].barIds.sort()).toEqual([BAR, 'osm:way/9'])
  })

  it('cannot be changed by anyone else', async () => {
    const id = await publicList(await joined('Flo'))
    const anna = await joined('Anna')
    expect((await call('PUT', `lists/${id}/bars`, { barId: BAR }, anna)).status).toBe(403)
    expect((await call('PATCH', `lists/${id}`, { title: 'Meins' }, anna)).status).toBe(403)
    expect((await call('DELETE', `lists/${id}`, undefined, anna)).status).toBe(403)
  })

  it('enforce the size limit, without counting what is already there', async () => {
    const token = await joined('Flo')
    const barIds = Array.from({ length: LIMITS.barsPerList }, (_, i) => `osm:node/${i}`)
    expect((await call('POST', 'lists', { title: 'Alles', barIds: [...barIds, 'osm:node/x'] }, token)).status).toBe(400)
    const id = (await call('POST', 'lists', { title: 'Voll', barIds }, token)).body.id
    expect((await call('PUT', `lists/${id}/bars`, { barId: barIds[0] }, token)).status).toBe(200)
    expect((await call('PUT', `lists/${id}/bars`, { barId: 'osm:node/x' }, token)).status).toBe(400)
  })

  describe('privacy', () => {
    it('hides a private list and its bars from everyone but the owner', async () => {
      const flo = await joined('Flo')
      await call('POST', 'lists', { title: 'Geheim', isPublic: false, barIds: [BAR] }, flo)
      const anna = await joined('Anna')
      for (const viewer of [await state(), await state(anna)]) {
        expect(viewer.lists.map((l) => l.title)).not.toContain('Geheim')
        expect(JSON.stringify(viewer.lists)).not.toContain(BAR)
      }
      expect((await state(flo)).lists.find((l) => l.title === 'Geheim')?.barIds).toEqual([BAR])
    })

    it('can be switched both ways without touching anything else', async () => {
      const flo = await joined('Flo')
      const id = await publicList(flo)
      await call('PATCH', `lists/${id}`, { description: 'Schön draußen' }, flo)
      await call('PATCH', `lists/${id}`, { isPublic: false }, flo)
      expect((await state()).lists).toEqual([])
      await call('PATCH', `lists/${id}`, { isPublic: true }, flo)
      expect((await state()).lists[0]).toMatchObject({ title: 'Gastgärten', description: 'Schön draußen', isPublic: true })
    })

    it('can only be switched by the owner', async () => {
      const id = await publicList(await joined('Flo'))
      expect((await call('PATCH', `lists/${id}`, { isPublic: false }, await joined('Anna'))).status).toBe(403)
      expect((await state()).lists[0].isPublic).toBe(true)
    })
  })

  describe('main list ("Meine Lokale")', () => {
    async function mainId(token: string): Promise<string> {
      return (await state(token)).lists.find((l) => l.isMain)!.id
    }

    it('starts private and can be made public', async () => {
      const flo = await joined('Flo')
      expect((await state()).lists).toEqual([])
      await call('PATCH', `lists/${await mainId(flo)}`, { isPublic: true }, flo)
      expect((await state()).lists.map((l) => l.title)).toEqual(['Favoriten von Flo'])
    })

    it('can be neither deleted nor renamed', async () => {
      const flo = await joined('Flo')
      const id = await mainId(flo)
      expect((await call('DELETE', `lists/${id}`, undefined, flo)).status).toBe(400)
      expect((await call('PATCH', `lists/${id}`, { title: 'Anders' }, flo)).status).toBe(400)
      expect((await state(flo)).lists[0].title).toBe('Favoriten von Flo')
    })

    it('is the only one per person', async () => {
      const flo = await joined('Flo')
      await publicList(flo)
      expect((await state(flo)).lists.filter((l) => l.isMain)).toHaveLength(1)
    })
  })
})

describe('requests', () => {
  it('reject unknown bars and broken bodies', async () => {
    const token = await joined('Flo')
    expect((await call('PUT', 'ratings', { barId: 'a b', stars: 4 }, token)).status).toBe(400)
    const res = await handle(new Request('https://x.test/api/ratings', { method: 'PUT', headers: { authorization: `Bearer ${token}` }, body: '{' }), env)
    expect(res.status).toBe(400)
  })

  it('answer 503 without a database (branch previews) and 404 for unknown paths', async () => {
    expect((await call('GET', 'nope')).status).toBe(404)
    env = { INVITE_CODE: CODE }
    expect((await call('GET', 'state')).status).toBe(503)
  })

  it('name the missing tables when the migration has not run', async () => {
    env = { DB: { ...testDb(), batch: async () => { throw new Error('D1_ERROR: no such table: members') } } }
    const r = await call('GET', 'state')
    expect(r.status).toBe(503)
    expect(r.body.error).toContain('Tabellen')
  })
})
