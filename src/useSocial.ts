// Talks to api/app.ts. A profile is a token in this browser; a personal link or name and
// password bring it to another device.
// When the API can't be reached (dev server alone, branch previews) status is "offline" and the
// site simply shows none of the friends' features.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Comment, ListView, SocialState } from './domain/social'
import { loadJson, saveJson } from './storage'

const TOKEN_KEY = 'freunde-token'
/** Coming back to the tab fetches what friends added, at most this often. */
const REFRESH_AFTER_MS = 60_000

/** Takes over a profile from a device link (#anmelden=…), and removes the secret from the address. */
function adoptDeviceLink(): void {
  const m = /(?:^#?|&)anmelden=([\w-]+)/.exec(location.hash)
  if (!m) return
  saveJson(TOKEN_KEY, m[1])
  history.replaceState(null, '', location.pathname + location.search)
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = loadJson<string | null>(TOKEN_KEY, null)
  const r = await fetch(`/api/${path}`, {
    ...init,
    headers: { ...(init.body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
  })
  const body = await r.json().catch(() => null) as { error?: string } | null
  if (!r.ok) throw new Error(body?.error ?? 'Der Server antwortet gerade nicht.')
  return body as T
}

const send = (method: string, body?: unknown): RequestInit => ({ method, body: body === undefined ? undefined : JSON.stringify(body) })

export function useSocial() {
  const [state, setState] = useState<SocialState | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'offline'>('loading')
  const lastFetch = useRef(0)

  const refresh = useCallback(async () => {
    lastFetch.current = Date.now()
    try {
      const next = await request<SocialState>('state')
      // A token the server doesn't know (bad link, deleted profile) is of no use any more.
      if (!next.me && loadJson<string | null>(TOKEN_KEY, null)) saveJson(TOKEN_KEY, null)
      setState(next)
      setStatus('ready')
    } catch (e) {
      console.warn('Freunde-Funktionen nicht erreichbar:', e)
      // A hiccup after a successful load keeps what is on screen.
      setStatus((s) => (s === 'ready' ? s : 'offline'))
    }
  }, [])

  useEffect(() => {
    adoptDeviceLink()
    void refresh()
    const onHash = () => {
      if (!location.hash.includes('anmelden=')) return
      adoptDeviceLink()
      void refresh()
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastFetch.current > REFRESH_AFTER_MS) void refresh()
    }
    window.addEventListener('hashchange', onHash)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('hashchange', onHash)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refresh])

  return useMemo(() => {
    /** Runs a change on the server, then shows the result. */
    const change = async <T,>(path: string, init: RequestInit): Promise<T> => {
      const out = await request<T>(path, init)
      await refresh()
      return out
    }
    const editBars = async (id: string, edit: (bars: string[]) => string[], body: unknown) => {
      setState((s) => s && { ...s, lists: s.lists.map((l) => (l.id === id ? { ...l, barIds: edit(l.barIds) } : l)) })
      try {
        await request(`lists/${id}/bars`, send('PUT', body))
      } catch (e) {
        await refresh()
        throw e
      }
    }
    return {
      state,
      status,
      refresh,
      async join(code: string, name: string, password: string) {
        const { token } = await request<{ token: string }>('join', send('POST', { code, name, password }))
        saveJson(TOKEN_KEY, token)
        await refresh()
      },
      async login(name: string, password: string) {
        const { token } = await request<{ token: string }>('login', send('POST', { name, password }))
        saveJson(TOKEN_KEY, token)
        await refresh()
      },
      setPassword: (password: string) => change('password', send('PUT', { password })),
      leave() {
        saveJson(TOKEN_KEY, null)
        void refresh()
      },
      deviceLink: () => `${location.origin}${location.pathname}#anmelden=${loadJson<string | null>(TOKEN_KEY, null) ?? ''}`,
      /** Shows the new rating at once; 0 removes it. */
      async rate(barId: string, stars: number) {
        setState((s) => {
          if (!s?.me) return s
          const memberId = s.me.id
          const others = s.ratings.filter((r) => !(r.barId === barId && r.memberId === memberId))
          return { ...s, ratings: stars ? [...others, { barId, memberId, stars, at: Date.now() }] : others }
        })
        try {
          await request('ratings', send('PUT', { barId, stars: stars || null }))
        } catch (e) {
          await refresh()
          throw e
        }
      },
      comments: (barId: string) => request<Comment[]>(`comments?bar=${encodeURIComponent(barId)}`),
      addComment: (barId: string, body: string) => change('comments', send('POST', { barId, body })),
      deleteComment: (id: string) => change(`comments/${id}`, send('DELETE')),
      createList: (title: string, barIds: string[], isPublic: boolean) => change<{ id: string }>('lists', send('POST', { title, barIds, isPublic })),
      /** Shows the change at once, so a ticked box doesn't wait for the server. */
      async updateList(id: string, patch: Partial<Pick<ListView, 'title' | 'description' | 'isPublic'>>) {
        setState((s) => s && { ...s, lists: s.lists.map((l) => (l.id === id ? { ...l, ...patch } : l)) })
        try {
          await request(`lists/${id}`, send('PATCH', patch))
        } catch (e) {
          await refresh()
          throw e
        }
      },
      deleteList: (id: string) => change(`lists/${id}`, send('DELETE')),
      /** Shows the change at once, like a rating: the heart has to feel instant. */
      setListBar: (id: string, barId: string, on: boolean) => editBars(id, (bars) => (on ? [...bars.filter((b) => b !== barId), barId] : bars.filter((b) => b !== barId)),
        { barId, on }),
      addBars: (id: string, barIds: string[]) => editBars(id, (bars) => [...bars, ...barIds.filter((b) => !bars.includes(b))], { barIds }),
    }
  }, [state, status, refresh])
}

export type Social = ReturnType<typeof useSocial>
