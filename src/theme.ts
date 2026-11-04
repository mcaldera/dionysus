// Visual identity of venue types. Colour is never the only signal: the legend chips,
// hover cards and panel always name the type as well.

import type { VenueType } from './domain/types'

export const TYPE_COLOR: Record<VenueType, string> = {
  pub_bar: '#e8890c',
  tschocherl: '#8b5cf6',
  beisl_wirtshaus: '#16a34a',
  heuriger: '#be123c',
  special: '#2563eb',
}

export const TYPE_ICON: Record<VenueType, string> = {
  pub_bar: '🍺',
  tschocherl: '☕',
  beisl_wirtshaus: '🍽️',
  heuriger: '🍷',
  special: '✨',
}

export const TYPE_SHORT: Record<VenueType, string> = {
  pub_bar: 'Bar & Pub',
  tschocherl: 'Tschocherl',
  beisl_wirtshaus: 'Beisl & Wirtshaus',
  heuriger: 'Heuriger',
  special: 'Besonders',
}
