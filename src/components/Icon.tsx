// Line icons (Lucide) in one weight and size, instead of emoji. Domain code refers to icons
// by name only, so it stays free of React.

import {
  ArrowLeftRight, ArrowUpRight, Ban, Beer, Check, ChevronDown, Clock3, ClipboardList, Coffee, Coins, Compass, Crosshair,
  Dices, Eraser, Footprints, Gem, Guitar, Heart, Hourglass, Map as MapIcon, MapPin, Martini, MessageCircle, Moon,
  Navigation, Pin, RotateCw, Route, Scale, Search, Shuffle, SlidersHorizontal, Sofa, Sparkles, Star, Sun, Target, Timer,
  TramFront, Trees, TriangleAlert, Undo2, Utensils, UtensilsCrossed, Wine, X, Zap, GripVertical, type LucideIcon,
} from 'lucide-react'
import type { VenueType } from '../domain/types'

const ICONS = {
  'arrow-left-right': ArrowLeftRight, 'arrow-up-right': ArrowUpRight, ban: Ban, beer: Beer, check: Check,
  'chevron-down': ChevronDown, clock: Clock3, clipboard: ClipboardList, coffee: Coffee, coins: Coins, compass: Compass,
  crosshair: Crosshair, dices: Dices, eraser: Eraser, walk: Footprints, gem: Gem, guitar: Guitar, heart: Heart,
  hourglass: Hourglass, map: MapIcon, pin: MapPin, martini: Martini, talk: MessageCircle, moon: Moon, navigation: Navigation,
  pushpin: Pin, rotate: RotateCw, route: Route, scale: Scale, search: Search, shuffle: Shuffle, sliders: SlidersHorizontal,
  sofa: Sofa, sparkles: Sparkles, star: Star, sun: Sun, target: Target, timer: Timer, tram: TramFront, trees: Trees,
  warn: TriangleAlert, undo: Undo2, utensils: Utensils, dish: UtensilsCrossed, wine: Wine, x: X, zap: Zap, grip: GripVertical,
} satisfies Record<string, LucideIcon>

export type IconName = keyof typeof ICONS

interface Props {
  name: IconName
  size?: number
  className?: string
  /** Filled shape, e.g. a set heart. */
  filled?: boolean
  title?: string
}

export default function Icon({ name, size = 16, className, filled, title }: Props) {
  const C = ICONS[name]
  return (
    <C size={size} strokeWidth={1.75} className={`icon${className ? ` ${className}` : ''}`}
      fill={filled ? 'currentColor' : 'none'} aria-hidden={title ? undefined : true} aria-label={title} />
  )
}

const TYPE_ICON_NAME: Record<VenueType, IconName> = {
  pub_bar: 'beer',
  tschocherl: 'coffee',
  beisl_wirtshaus: 'dish',
  heuriger: 'wine',
  special: 'sparkles',
}

export function TypeIcon({ type, size = 14 }: { type: VenueType; size?: number }) {
  return <Icon name={TYPE_ICON_NAME[type]} size={size} />
}

/** Walking or riding, for legs and travel times. */
export function ModeIcon({ mode, size = 14 }: { mode: 'walk' | 'transit' | 'unreachable'; size?: number }) {
  return <Icon name={mode === 'walk' ? 'walk' : 'tram'} size={size} />
}
