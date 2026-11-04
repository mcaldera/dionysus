// Taste quiz: a few this-or-that questions about kinds of places (not about bars by name,
// which nobody can judge from a list of 2,000). Answers become the group's preferences.

import { TAGS, VENUE_TYPES, type Participant, type Tag, type VenueType } from './types'

export interface TasteOption {
  icon: string
  label: string
  hint?: string
  likes?: Tag[]
  avoids?: Tag[]
  likedTypes?: VenueType[]
}

export interface TasteQuestion {
  id: string
  question: string
  options: TasteOption[]
  /** Several options may be chosen; otherwise one, or "Egal". */
  multi?: boolean
}

export const QUESTIONS: TasteQuestion[] = [
  {
    id: 'vibe', question: 'Wo fühlt ihr euch eher wohl?', options: [
      { icon: '🪵', label: 'Altes Beisl', hint: 'Holzvertäfelung, Stammtisch, seit Jahrzehnten gleich', likes: ['urig'] },
      { icon: '🍸', label: 'Neue Bar', hint: 'Durchdachtes Konzept, schönes Design', likes: ['modern'] },
    ],
  },
  {
    id: 'price', question: 'Was darf ein Seidl kosten?', options: [
      { icon: '🪙', label: 'So wenig wie möglich', hint: 'Ehrliche Preise, nix Schickes', likes: ['preiswert'], avoids: ['gehoben'] },
      { icon: '🥂', label: 'Darf auch mehr sein', hint: 'Schöne Gläser, aufmerksamer Service', likes: ['gehoben'], avoids: ['preiswert'] },
    ],
  },
  {
    id: 'absteige', question: 'Und richtige Absteigen?', options: [
      { icon: '🎰', label: 'Gehören dazu', hint: 'Neonlicht, Automat, Stammgäste mit Geschichten', likes: ['absteige'] },
      { icon: '🙅', label: 'Lieber nicht', hint: 'Ein bisschen gepflegt darf es sein', avoids: ['absteige'] },
    ],
  },
  {
    id: 'food', question: 'Wollt ihr unterwegs essen?', options: [
      { icon: '🍖', label: 'Ja, zwischendurch was Warmes', hint: 'Schnitzel, Gulasch, Würstel', likes: ['essen'] },
      { icon: '🍺', label: 'Nur trinken', hint: 'Essen spielt keine Rolle' },
    ],
  },
  {
    id: 'outside', question: 'Drinnen oder draußen?', options: [
      { icon: '🌳', label: 'Draußen, wenn es geht', hint: 'Gastgarten oder Schanigarten', likes: ['gastgarten'] },
      { icon: '🛋️', label: 'Drinnen passt', hint: 'Hauptsache gemütlich' },
    ],
  },
  {
    id: 'music', question: 'Live-Musik?', options: [
      { icon: '🎸', label: 'Gern, mit Band', hint: 'Konzerte, Sessions, Kleinkunst', likes: ['live_musik'] },
      { icon: '🗣️', label: 'Lieber zum Reden', hint: 'Musik leise im Hintergrund', avoids: ['live_musik'] },
    ],
  },
  {
    id: 'late', question: 'Wie lange geht es?', options: [
      { icon: '🌙', label: 'Bis spät in die Nacht', hint: 'Lokale, die nach 1 Uhr noch offen haben', likes: ['lang_offen'] },
      { icon: '☀️', label: 'Eher tagsüber', hint: 'Spätestens um Mitternacht daheim' },
    ],
  },
  {
    id: 'types', multi: true, question: 'Was soll auf jeden Fall dabei sein?', options: [
      { icon: '🍺', label: 'Bar & Pub', hint: 'Irish Pub, Craft-Beer-Bar, Eckbar', likedTypes: ['pub_bar'] },
      { icon: '☕', label: 'Tschocherl', hint: 'Kleines Espresso oder Stüberl ums Eck', likedTypes: ['tschocherl'] },
      { icon: '🍽️', label: 'Beisl & Wirtshaus', hint: 'Wiener Küche, Bier vom Fass', likedTypes: ['beisl_wirtshaus'] },
      { icon: '🍷', label: 'Heuriger', hint: 'Wein statt Bier, eher am Stadtrand', likedTypes: ['heuriger'] },
      { icon: '✨', label: 'Besondere Orte', hint: 'Kegelbahn, Boulderhalle, Konzertlokal', likedTypes: ['special'] },
    ],
  },
]

/** Answers by question ID: the chosen option indexes; empty = "Egal". */
export type TasteAnswers = Record<string, number[]>

export function preferencesFrom(answers: TasteAnswers, name = 'Wir'): Participant {
  const likes = new Set<Tag>()
  const avoids = new Set<Tag>()
  const likedTypes = new Set<VenueType>()
  for (const q of QUESTIONS) {
    for (const i of answers[q.id] ?? []) {
      const o = q.options[i]
      o?.likes?.forEach((t) => likes.add(t))
      o?.avoids?.forEach((t) => avoids.add(t))
      o?.likedTypes?.forEach((t) => likedTypes.add(t))
    }
  }
  // Liking every type says nothing.
  const types = likedTypes.size === VENUE_TYPES.length ? [] : VENUE_TYPES.filter((t) => likedTypes.has(t))
  return {
    name,
    likes: TAGS.filter((t) => likes.has(t) && !avoids.has(t)),
    avoids: TAGS.filter((t) => avoids.has(t) && !likes.has(t)),
    likedTypes: types,
    avoidedTypes: [],
  }
}
