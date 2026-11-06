// Data model from SPEC section 6.

export type VenueType = 'pub_bar' | 'tschocherl' | 'beisl_wirtshaus' | 'heuriger'

export type Tag =
  | 'essen' | 'urig' | 'modern' | 'preiswert' | 'gehoben'
  | 'gastgarten' | 'lang_offen' | 'live_musik' | 'absteige'
  | 'cocktails' | 'wein' | 'studenten' | 'fussball' | 'dart' | 'billard' | 'spiele' | 'karaoke' | 'tanzen'
  | 'beliebt' | 'top_bewertet' | 'geheimtipp' | 'polarisiert'

export interface Bar {
  id: string
  matrixIndex: number
  name: string
  district: number
  lat: number
  lon: number
  venueType: VenueType
  address?: string
  /** Overrides the name in the Google Maps link when the plain name finds the wrong place. */
  mapsQuery?: string
  /** Google place id, when known: the Maps link then opens exactly this place. */
  placeId?: string
  /** 0-100 scores from Google reviews (absent when the bar isn't matched on Google). */
  /** How well known: rank by number of reviews among all bars. */
  popularity?: number
  /** How happy guests are: 0 = 3 stars, 50 = 4, 100 = 5, corrected for few reviews. */
  satisfaction?: number
  /** Well liked but little known. */
  geheimtipp?: number
  /** Love it or hate it: many 1-2 and many 5 star reviews. */
  polarizing?: number
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
  /** One or two sentences written by a local LLM from reviews, website and forum tips (own words). */
  description?: string
  /** Short character keywords from the same profile. */
  keywords?: string[]
  /** From the bar profile: a 16-number vector (int8 scale) for comparing any two bars, and the
   *  matrix indices of the 10 most similar bars. The Atlas layouts are in atlas.json. */
  profile?: { vec: number[]; similar: number[] }
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

export const VENUE_TYPES: VenueType[] = ['pub_bar', 'tschocherl', 'beisl_wirtshaus', 'heuriger']

export const VENUE_TYPE_LABEL: Record<VenueType, string> = {
  pub_bar: 'Bar & Pub',
  tschocherl: 'Tschocherl & Café-Bar',
  beisl_wirtshaus: 'Beisl & Wirtshaus',
  heuriger: 'Heuriger & Buschenschank',
}

export const TAGS: Tag[] = [
  'essen', 'urig', 'modern', 'preiswert', 'gehoben', 'gastgarten', 'lang_offen', 'live_musik', 'absteige',
  'cocktails', 'wein', 'studenten', 'fussball', 'dart', 'billard', 'spiele', 'karaoke', 'tanzen',
  'beliebt', 'top_bewertet', 'geheimtipp', 'polarisiert',
]

/** Tags from the Google-review scores, set by the pipeline (07_build_site_data.py, SCORE_TAGS);
 *  shown as meters and badges rather than chips, and not editable. */
export const SCORE_TAGS: Tag[] = ['beliebt', 'top_bewertet', 'geheimtipp', 'polarisiert']

/** Tags about what a bar is like (everything but the score tags). */
export const CHARACTER_TAGS: Tag[] = TAGS.filter((t) => !SCORE_TAGS.includes(t))

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
  cocktails: 'Cocktails',
  wein: 'Wein',
  studenten: 'Studenten',
  fussball: 'Fußball',
  dart: 'Dart',
  billard: 'Billard',
  spiele: 'Spiele & Quiz',
  karaoke: 'Karaoke',
  tanzen: 'Tanzen',
  beliebt: 'Sehr bekannt',
  top_bewertet: 'Top bewertet',
  geheimtipp: 'Geheimtipp',
  polarisiert: 'Polarisiert',
}
