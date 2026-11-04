// Walking paths from the FOSSGIS OSRM server (routing.openstreetmap.de), fetched on
// demand and kept in memory. Transit legs are drawn as arcs; see domain/geo.ts.

const cache = new Map<string, Promise<[number, number][] | null>>()

export function walkingPath(a: { lat: number; lon: number }, b: { lat: number; lon: number }): Promise<[number, number][] | null> {
  const key = `${a.lon.toFixed(5)},${a.lat.toFixed(5)};${b.lon.toFixed(5)},${b.lat.toFixed(5)}`
  let p = cache.get(key)
  if (!p) {
    p = fetch(`https://routing.openstreetmap.de/routed-foot/route/v1/driving/${key}?overview=full&geometries=geojson`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => (d?.routes?.[0]?.geometry?.coordinates as [number, number][]) ?? null)
      .catch(() => null)
    cache.set(key, p)
  }
  return p
}
