// Small geometry helpers for drawing legs.

/** A gentle arc from a to b, for transit legs whose real path we don't have. */
export function arc(a: [number, number], b: [number, number], steps = 24, bend = 0.18): [number, number][] {
  const [x1, y1] = a
  const [x2, y2] = b
  // Control point: midpoint pushed sideways, scaled for latitude.
  const mx = (x1 + x2) / 2
  const my = (y1 + y2) / 2
  const k = Math.cos((my * Math.PI) / 180)
  const dx = (x2 - x1) * k
  const dy = y2 - y1
  const cx = mx - (dy * bend) / k
  const cy = my + dx * bend
  const out: [number, number][] = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const u = 1 - t
    out.push([u * u * x1 + 2 * u * t * cx + t * t * x2, u * u * y1 + 2 * u * t * cy + t * t * y2])
  }
  return out
}
