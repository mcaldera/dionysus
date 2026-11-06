// Visual identity of venue types. Colour is never the only signal: the legend chips,
// hover cards and panel always name the type as well.

import type { VenueType } from './domain/types'

// Checked with the dataviz palette validator: lightness band, chroma, contrast on light map
// tiles, and colour-vision-deficiency separation between all types (icons: components/Icon.tsx).
export const TYPE_COLOR: Record<VenueType, string> = {
  pub_bar: '#E2711D',
  tschocherl: '#7B61FF',
  beisl_wirtshaus: '#1E9E6A',
  heuriger: '#B5175E',
}

export const TYPE_SHORT: Record<VenueType, string> = {
  pub_bar: 'Bar & Pub',
  tschocherl: 'Tschocherl',
  beisl_wirtshaus: 'Beisl & Wirtshaus',
  heuriger: 'Heuriger',
}

// The selected bar on the map: a pale beer-foam yellow, apart from every type colour, outlined in ink.
export const SELECT_COLOR = '#FFE08F'
export const SELECT_HALO = 'rgba(255, 214, 112, 0.42)'

/** The heart on bars in "Meine Lokale". */
export const MINE_COLOR = '#E5546E'
