// Data model from SPEC section 6.

export type VenueType = 'pub_bar' | 'tschocherl' | 'beisl_wirtshaus' | 'heuriger' | 'special'

export type Tag =
  | 'essen' | 'urig' | 'modern' | 'preiswert' | 'gehoben'
  | 'gastgarten' | 'lang_offen' | 'live_musik' | 'absteige'

export interface Bar {
  id: string
  matrixIndex: number
  name: string
  district: number
  lat: number
  lon: number
  venueType: VenueType
  address?: string
  website?: string
  phone?: string
  wheelchair?: string
  openingHoursText?: string
  weeklyOpen: [number, number][] | null
  official: string[]
  /** Public lists that recommend the bar. */
  /** kind: what the source praises, e.g. "rau" for a forum mention of a rough, beloved place. */
  tips?: {
    source: string
    url: string
    kind?: string
    /** Forum tips: "stark" (several threads or many upvotes) or "erwähnt" (single mention). */
    strength?: 'stark' | 'erwähnt'
    threads?: number
  }[]
  tags: Tag[]
  unreviewedTags: Tag[]
  description?: string
}

export interface Participant {
  name: string
  likes: Tag[]
  avoids: Tag[]
  /** From the taste finder; count like tags in `match`. */
  likedTypes?: VenueType[]
  avoidedTypes?: VenueType[]
}

export interface Manifest {
  dataVersion: string
  generated: string
  n: number
  order: string[]
  newestOfficialEdition: string | null
}

export const ALL_DISTRICTS = Array.from({ length: 23 }, (_, i) => i + 1)

export const VENUE_TYPES: VenueType[] = ['pub_bar', 'tschocherl', 'beisl_wirtshaus', 'heuriger', 'special']

export const VENUE_TYPE_LABEL: Record<VenueType, string> = {
  pub_bar: 'Bar & Pub',
  tschocherl: 'Tschocherl & Café-Bar',
  beisl_wirtshaus: 'Beisl & Wirtshaus',
  heuriger: 'Heuriger & Buschenschank',
  special: 'Besondere Orte',
}

export const TAGS: Tag[] = [
  'essen', 'urig', 'modern', 'preiswert', 'gehoben', 'gastgarten', 'lang_offen', 'live_musik', 'absteige',
]

export const TAG_LABEL: Record<Tag, string> = {
  essen: 'Essen',
  urig: 'Urig',
  modern: 'Modern',
  preiswert: 'Preiswert',
  gehoben: 'Gehoben',
  gastgarten: 'Gastgarten',
  lang_offen: 'Lang offen',
  live_musik: 'Live-Musik',
  absteige: 'Absteige',
}
