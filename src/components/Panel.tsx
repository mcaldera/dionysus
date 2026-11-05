// The panel beside the map: a floating column on desktop, a bottom sheet on phones that is
// dragged (or tapped) between a peek, half the screen and nearly full height.

import { useLayoutEffect, useRef, useState } from 'react'

export type Snap = 'peek' | 'half' | 'full'

/** Peek: the handle plus the first line of the top card. */
const PEEK = 92
const NEXT: Record<Snap, Snap> = { peek: 'half', half: 'full', full: 'peek' }

interface Props {
  phone: boolean
  /** Nothing to show: no sheet on a phone. */
  empty: boolean
  /** Desktop: end above the map buttons in the bottom-right corner. */
  withFabs: boolean
  snap: Snap
  onSnap: (s: Snap) => void
  /** Height the sheet covers once it settles, for keeping map content clear of it. */
  onHeight: (px: number) => void
  children: React.ReactNode
}

function heights(total: number): Record<Snap, number> {
  return { peek: PEEK, half: Math.round(total * 0.48), full: Math.max(PEEK, total - 10) }
}

export default function Panel({ phone, empty, withFabs, snap, onSnap, onHeight, children }: Props) {
  const ref = useRef<HTMLElement>(null)
  const [total, setTotal] = useState(0)
  const [drag, setDrag] = useState<number | null>(null)
  const start = useRef<{ y: number; h: number; moved: boolean } | null>(null)
  const sheet = phone && !empty

  // The sheet sizes itself against the map area, which changes with rotation and browser bars.
  useLayoutEffect(() => {
    const parent = ref.current?.parentElement
    if (!sheet || !parent) return
    const ro = new ResizeObserver(() => setTotal(parent.clientHeight))
    ro.observe(parent)
    return () => ro.disconnect()
  }, [sheet])

  const h = heights(total || window.innerHeight)
  const settled = h[snap]
  useLayoutEffect(() => { onHeight(sheet ? settled : 0) }, [sheet, settled, onHeight])

  if (!phone) return <aside className={`panel${withFabs ? ' with-fabs' : ''}`}>{children}</aside>
  if (empty) return null

  function down(e: React.PointerEvent) {
    e.currentTarget.setPointerCapture(e.pointerId)
    start.current = { y: e.clientY, h: settled, moved: false }
  }
  function move(e: React.PointerEvent) {
    const s = start.current
    if (!s) return
    const dy = s.y - e.clientY
    if (Math.abs(dy) > 4) s.moved = true
    if (s.moved) setDrag(Math.min(h.full, Math.max(PEEK, s.h + dy)))
  }
  function up() {
    const s = start.current
    start.current = null
    if (!s) return
    if (!s.moved || drag === null) {
      onSnap(NEXT[snap])
    } else {
      const order: Snap[] = ['peek', 'half', 'full']
      onSnap(order.reduce((best, k) => (Math.abs(h[k] - drag) < Math.abs(h[best] - drag) ? k : best), snap))
    }
    setDrag(null)
  }

  return (
    <aside ref={ref} className={`panel sheet${drag !== null ? ' dragging' : ''}`} data-snap={snap}
      style={{ height: drag ?? settled }}>
      <div className="sheet-handle" role="button" tabIndex={0} aria-label="Bereich vergrößern oder verkleinern"
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSnap(NEXT[snap]) } }}>
        <span />
      </div>
      <div className="sheet-body">{children}</div>
    </aside>
  )
}
