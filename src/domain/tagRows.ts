// Apply data/own/tags.csv rows on top of the published tags, as 07_build_site_data.py does.

import { TAGS, type Bar, type Tag } from './types'

export interface TagRow {
  bar_id: string
  tag: string
  value: string
  source: string
  evidence: string
  reviewed: string
}

export function applyTagRows(bars: Bar[], rows: TagRow[]): Bar[] {
  const byBar = new Map<string, TagRow[]>()
  for (const r of rows) byBar.set(r.bar_id, [...(byBar.get(r.bar_id) ?? []), r])
  return bars.map((b) => {
    const rs = byBar.get(b.id)
    if (!rs) return b
    const tags = new Set(b.tags)
    const unreviewed = new Set(b.unreviewedTags)
    for (const r of rs) {
      if (!TAGS.includes(r.tag as Tag)) continue
      const t = r.tag as Tag
      if (r.value === '1') {
        tags.add(t)
        if (r.reviewed === '1') unreviewed.delete(t)
        else unreviewed.add(t)
      } else {
        tags.delete(t)
        unreviewed.delete(t)
      }
    }
    return { ...b, tags: TAGS.filter((t) => tags.has(t)), unreviewedTags: TAGS.filter((t) => unreviewed.has(t)) }
  })
}
