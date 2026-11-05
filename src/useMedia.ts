import { useEffect, useState } from 'react'

/** Phones and small tablets: full-screen map with a bottom sheet instead of the side panel. */
export const PHONE = '(max-width: 900px)'

export function useMedia(query: string): boolean {
  const [on, setOn] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(query).matches)
  useEffect(() => {
    const m = matchMedia(query)
    const change = () => setOn(m.matches)
    change()
    m.addEventListener('change', change)
    return () => m.removeEventListener('change', change)
  }, [query])
  return on
}
