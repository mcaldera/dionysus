import { describe, expect, it } from 'vitest'
import { matchesFilter, type MapFilter } from './filter'
import {
  formatStars, friendFilterCount, friendFilterSet, groupRanking, indexByBar, listLabel, mainListOf, memberRanking, NO_FRIEND_FILTER, recentActivity, recommendForMe, tasteMatches,
  type ListView,
  type Rating, type SocialState,
} from './social'
import { VENUE_TYPES, type Bar } from './types'

function bar(id: string, vec?: number[]): Bar {
  return {
    id, matrixIndex: 0, name: id.toUpperCase(), district: 1, lat: 48.2, lon: 16.37, venueType: 'pub_bar',
    weeklyOpen: null, official: [], tags: [], unreviewedTags: [], profile: vec ? { vec, similar: [] } : undefined,
  }
}

const me = { id: 'me', name: 'Ich', hasPassword: true }
const flo = { id: 'flo', name: 'Flo' }
const anna = { id: 'anna', name: 'Anna' }

function state(ratings: [string, string, number][], extra: Partial<SocialState> = {}): SocialState {
  return {
    me, members: [anna, flo, me], commentCounts: {}, lists: [], recentComments: [],
    ratings: ratings.map(([memberId, barId, stars], i): Rating => ({ memberId, barId, stars, at: i })),
    ...extra,
  }
}

const bars = [bar('a'), bar('b'), bar('c')]

describe('stats', () => {
  it('averages ratings and knows the comments', () => {
    const idx = indexByBar(state([['flo', 'a', 5], ['anna', 'a', 2]], { commentCounts: { b: 3 } }))
    expect(idx.get('a')?.avg).toBe(3.5)
    expect(idx.get('a')?.ratings[0].memberId).toBe('flo')
    expect(idx.get('b')).toEqual({ avg: null, ratings: [], comments: 3 })
  })

  it('formats like in Austria', () => expect(formatStars(4.25)).toBe('4,3'))
})

describe('main list', () => {
  const list = (id: string, ownerId: string, isMain: boolean): ListView => ({ id, ownerId, title: `Favoriten von ${ownerId}`, description: '', updatedAt: 0, isPublic: true, isMain, barIds: [] })
  const lists = [list('other', 'me', false), list('flos', 'flo', true), list('mine', 'me', true)]

  it('is my own, not a friend\'s', () => expect(mainListOf(state([], { lists }))?.id).toBe('mine'))
  it('needs a profile', () => expect(mainListOf(state([], { lists, me: null }))).toBeNull())
  it('reads "Meine Lokale" only to its owner', () => {
    const s = state([], { lists })
    expect(listLabel(lists[2], s)).toBe('Meine Lokale')
    expect(listLabel(lists[1], s)).toBe('Favoriten von flo')
    expect(listLabel(lists[0], s)).toBe('Favoriten von me')
  })
})

describe('friend filter', () => {
  const s = state([['flo', 'a', 5], ['anna', 'a', 3], ['flo', 'b', 2], ['me', 'b', 4]], {
    commentCounts: { c: 1 }, lists: [{ id: 'l', ownerId: 'flo', title: 'T', description: '', updatedAt: 0, isPublic: true, isMain: false, barIds: ['c'] }],
  })
  const idx = indexByBar(s)
  const run = (f: Partial<typeof NO_FRIEND_FILTER>) => [...friendFilterSet(bars, s, idx, { ...NO_FRIEND_FILTER, ...f }) ?? []].sort()

  it('is off when nothing is set', () => expect(friendFilterSet(bars, s, idx, NO_FRIEND_FILTER)).toBeNull())
  it('keeps any rated bar at 0', () => expect(run({ minRating: 0 })).toEqual(['a', 'b']))
  it('applies the minimum to the average', () => expect(run({ minRating: 3.5 })).toEqual(['a']))
  it('applies the minimum to one person, when chosen', () => expect(run({ ratedBy: 'anna', minRating: 4 })).toEqual([]))
  it('finds commented bars', () => expect(run({ commented: true })).toEqual(['c']))
  it('finds what I have not rated', () => expect(run({ unratedByMe: true })).toEqual(['a', 'c']))
  it('finds a list', () => expect(run({ listId: 'l' })).toEqual(['c']))
  it('counts conditions', () => expect(friendFilterCount({ ...NO_FRIEND_FILTER, commented: true, listId: 'l' })).toBe(2))

  it('narrows the map filter', () => {
    const f: MapFilter = { venueTypes: new Set(VENUE_TYPES), tags: new Set(), sources: new Set(), tipKinds: new Set(), weakTips: false, openAt: null, includeUnknownHours: true }
    expect(matchesFilter(bars[0], { ...f, friends: new Set(['b']) })).toBe(false)
    expect(matchesFilter(bars[1], { ...f, friends: new Set(['b']) })).toBe(true)
    expect(matchesFilter(bars[0], { ...f, friends: null })).toBe(true)
  })
})

describe('rankings', () => {
  it('puts three agreeing friends above one enthusiast', () => {
    const s = state([['flo', 'a', 5], ['flo', 'b', 5], ['anna', 'b', 4], ['me', 'b', 5]])
    expect(groupRanking(bars, indexByBar(s)).map((r) => r.bar.id)).toEqual(['b', 'a'])
  })

  it('lists one person\'s bars, best first, and skips bars no longer on the site', () => {
    const s = state([['flo', 'a', 3], ['flo', 'b', 5], ['flo', 'gone', 5], ['anna', 'c', 5]])
    expect(memberRanking(bars, s, 'flo').map((r) => r.bar.id)).toEqual(['b', 'a'])
  })
})

describe('taste', () => {
  it('measures agreement on shared bars only', () => {
    const s = state([['me', 'a', 5], ['me', 'b', 1], ['flo', 'a', 5], ['flo', 'b', 1], ['anna', 'a', 1], ['anna', 'b', 5], ['anna', 'c', 5]])
    const [first, second] = tasteMatches(s)
    expect(first).toMatchObject({ member: flo, agreement: 1, shared: 2 })
    expect(second).toMatchObject({ member: anna, agreement: 0, shared: 2 })
    expect(first.weight).toBeGreaterThan(second.weight)
  })

  it('stays neutral about a friend with nothing in common', () => {
    expect(tasteMatches(state([['flo', 'a', 5]]))[0]).toMatchObject({ shared: 0, weight: 0.6 })
  })
})

describe('recommendations', () => {
  const vecBars = [bar('liked', [10, 0]), bar('close', [9, 1]), bar('far', [-10, 3]), bar('hated', [0, 10]), bar('nearhated', [1, 10])]

  it('needs a profile', () => {
    expect(recommendForMe(bars, state([['flo', 'a', 5]], { me: null }))).toEqual([])
  })

  it('never suggests what I already rated', () => {
    expect(recommendForMe(bars, state([['me', 'a', 2], ['flo', 'a', 5]]))).toEqual([])
  })

  it('suggests what friends love and names them', () => {
    const [rec] = recommendForMe(bars, state([['flo', 'a', 5]]))
    expect(rec.bar.id).toBe('a')
    expect(rec.reason).toBe('Flo gibt 5 ★')
  })

  it('leaves out what friends dislike', () => {
    expect(recommendForMe(bars, state([['flo', 'a', 1]]))).toEqual([])
  })

  it('trusts the friend who rates like me', () => {
    const s = state([
      ['me', 'a', 5], ['me', 'b', 1], ['flo', 'a', 5], ['flo', 'b', 1], ['anna', 'a', 1], ['anna', 'b', 5],
      ['flo', 'c', 5], ['anna', 'c', 2],
      ['flo', 'd', 2], ['anna', 'd', 5],
    ])
    const list = recommendForMe([...bars, bar('d')], s)
    expect(list.map((r) => r.bar.id)).toEqual(['c'])
  })

  it('finds bars like the ones I loved, even with no friend rating', () => {
    const [rec, ...rest] = recommendForMe(vecBars, state([['me', 'liked', 5]]))
    expect(rec.bar.id).toBe('close')
    expect(rec.reason).toBe('Ähnlich wie LIKED (von dir 5 ★)')
    expect(rest.map((r) => r.bar.id)).not.toContain('far')
  })

  it('holds back bars like the ones I disliked', () => {
    const list = recommendForMe(vecBars, state([['me', 'hated', 1], ['flo', 'nearhated', 4]]))
    const alone = recommendForMe(vecBars, state([['flo', 'nearhated', 4]]))
    expect(alone[0].score).toBeGreaterThan(list[0]?.score ?? 0)
  })
})

describe('activity', () => {
  it('merges comments and ratings, newest first', () => {
    const s = state([['flo', 'a', 4]], { recentComments: [{ id: 'x', barId: 'b', memberId: 'anna', body: 'Hi', at: 99 }] })
    expect(recentActivity(s).map((a) => a.kind)).toEqual(['comment', 'rating'])
  })
})
