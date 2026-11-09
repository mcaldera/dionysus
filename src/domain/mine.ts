// Share links for "Meine Lokale": a link carries a copy of the list to another device or friend
// (#meine=…), with or without a profile.

const PREFIX: [string, string][] = [['osm:node/', 'n'], ['osm:way/', 'w'], ['osm:relation/', 'r']]

/** Short form of a bar ID for links: "osm:node/123" → "n123"; other IDs stay as they are. */
function shortId(id: string): string {
  for (const [long, short] of PREFIX) if (id.startsWith(long) && /^\d+$/.test(id.slice(long.length))) return short + id.slice(long.length)
  return encodeURIComponent(id)
}

function longId(s: string): string {
  const p = PREFIX.find(([, short]) => s.startsWith(short) && /^\d+$/.test(s.slice(1)))
  return p ? p[0] + s.slice(1) : decodeURIComponent(s)
}

/** The hash part of a share link, e.g. "meine=n123.w45". */
export function encodeMine(ids: string[]): string {
  return `meine=${ids.map(shortId).join('.')}`
}

/** IDs from a location hash, or null if it holds no list. */
export function decodeMine(hash: string): string[] | null {
  const m = /(?:^#?|&)meine=([^&]*)/.exec(hash)
  if (!m) return null
  try {
    return [...new Set(m[1].split('.').filter(Boolean).map(longId))]
  } catch {
    return null
  }
}
