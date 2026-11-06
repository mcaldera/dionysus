// Local tag edit mode, dev server only (SPEC 5.5). Saves to data/own/tags.csv
// through devTagsPlugin, as source "manual" and reviewed.

import { CHARACTER_TAGS, TAG_LABEL, type Bar } from '../domain/types'

interface Props {
  bar: Bar
  onChange: (bar: Bar, tag: string, value: 0 | 1) => void
}

export default function TagEditor({ bar, onChange }: Props) {
  return (
    <details className="tag-editor">
      <summary>Tags bearbeiten (nur lokal)</summary>
      <div className="tags">
        {CHARACTER_TAGS.map((t) => {
          const on = bar.tags.includes(t)
          return (
            <button key={t} type="button" className={on ? 'tag on' : 'tag off'} aria-pressed={on}
              onClick={() => onChange(bar, t, on ? 0 : 1)}>
              {TAG_LABEL[t]}
            </button>
          )
        })}
      </div>
    </details>
  )
}
