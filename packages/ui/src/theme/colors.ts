/**
 * MANA's design system palette — deep indigo and white, taken from the logo, with two deliberate
 * semantic accents: teal for "done / paid" and a single warm gold for "ready / reward". Every
 * screen composes from these tokens, never a one-off hex value, so the whole app reads as one
 * system and stays trivially re-themeable.
 *
 * The `water*` names are historical (the app began in blue). They are kept so existing screens keep
 * compiling, and now hold the indigo values; new code should prefer the `indigo*` names.
 */
export const colors = {
  // Surfaces
  white: '#FFFFFF',
  surface: '#F4F6FF', // soft indigo-white — the screen background; cards sit on it in pure white
  surfaceRaised: '#FFFFFF',

  // Indigo — brand, primary actions
  indigoPale: '#E8ECFF', // tinted fills, chips
  indigoMist: '#C4CCF0', // dashed outlines, dividers
  indigoSoft: '#9BAEF5', // glows, soft accents
  indigoBright: '#5468D4', // gradient start, highlights
  indigo: '#3A4DB0', // primary
  indigoMid: '#2D3D9E', // pressed states, strong text on pale fills
  indigoDeep: '#1B2878', // gradient end, deep accents
  ink: '#0F1743', // body text on white — reads as "ink", not pure black
  night: '#080E2B', // darkest

  // Historical names for the indigo family (see above)
  waterPale: '#E8ECFF',
  waterLight: '#9BAEF5',
  water: '#3A4DB0',
  waterDeep: '#1B2878',
  waterInk: '#0F1743',
  waterMidnight: '#080E2B',

  // Teal — "done", paid, success
  tealLight: '#5EEAD4',
  teal: '#0D9488',
  tealDeep: '#0B5F57',
  tealPale: '#D9F5EE',

  // Amber — the one warm accent, reserved for "ready" and rewards
  amberLight: '#FDE68A',
  amber: '#F59E0B',
  amberDeep: '#9A5B00',
  amberPale: '#FFF4D6',
  goldInk: '#4D2F00', // text and icons drawn on gold

  // Neutral — waiting / inactive states, secondary text (tinted indigo, never flat grey)
  slate: '#8791B5',
  slateDeep: '#4A5280',

  danger: '#DC2626',
  dangerPale: '#FEE2E2',
  border: '#E2E7FB',
  shadow: '#1B2878',
} as const;

/** A gradient: its colours, where each one sits, and the direction (0–1 box coordinates). */
export interface GradientSpec {
  colors: readonly string[];
  locations?: readonly number[];
  start: { x: number; y: number };
  end: { x: number; y: number };
}

/** Named gradients. Keeping them central (not inlined per screen) is what makes a brand change a
 * one-file change. `hero` and `promo` run light to deep; `gold` is for rewards only. */
export const gradients = {
  hero: [colors.indigoBright, colors.indigo, colors.indigoDeep] as const,
  primaryButton: [colors.indigoBright, colors.indigo] as const,
  primaryButtonPressed: [colors.indigo, colors.indigoDeep] as const,
  success: [colors.tealLight, colors.teal] as const,
  card: [colors.white, colors.surface] as const,
  chipSelected: [colors.indigoBright, colors.indigo] as const,
  fab: [colors.indigoBright, colors.indigo] as const,
} as const;

/** The richer gradients the redesigned screens use, with their stop positions and direction. */
export const brandGradients = {
  hero: {
    colors: gradients.hero,
    locations: [0, 0.46, 1],
    start: { x: 0.25, y: 0 },
    end: { x: 0.75, y: 1 },
  },
  promo: {
    colors: [colors.indigoBright, colors.indigoMid, colors.indigoDeep],
    locations: [0, 0.58, 1],
    start: { x: 0, y: 0 },
    end: { x: 1, y: 1 },
  },
  /** Buttons and the selected chip. */
  primary: {
    colors: [colors.indigoBright, colors.indigo],
    start: { x: 0, y: 0 },
    end: { x: 0, y: 1 },
  },
  tabPill: {
    colors: [colors.indigoBright, colors.indigoMid],
    start: { x: 0.2, y: 0 },
    end: { x: 0.8, y: 1 },
  },
  gold: {
    colors: [colors.amberLight, colors.amber],
    start: { x: 0.2, y: 0 },
    end: { x: 0.8, y: 1 },
  },
  /** Soft tile behind icons. */
  tile: {
    colors: ['#EEF1FF', '#DDE3FF'],
    start: { x: 0.2, y: 0 },
    end: { x: 0.8, y: 1 },
  },
  /** Tile behind the brand mark on an empty state. */
  tileSoft: {
    colors: ['#F1F3FF', '#DCE2FF'],
    start: { x: 0.2, y: 0 },
    end: { x: 0.8, y: 1 },
  },
  /** The fill of a collected stamp drop. */
  stamp: {
    colors: ['#7F93E6', '#4458CC', colors.indigoDeep],
    locations: [0, 0.5, 1],
    start: { x: 0, y: 0 },
    end: { x: 1, y: 1 },
  },
  /** The free-wash card when a free wash is ready. */
  rewardCard: {
    colors: ['#FFFBEA', '#FFF1C7'],
    start: { x: 0.2, y: 0 },
    end: { x: 0.8, y: 1 },
  },
  /** An ordinary card with a faint lift. */
  cardLift: {
    colors: [colors.white, '#F8F9FF'],
    start: { x: 0, y: 0 },
    end: { x: 0, y: 1 },
  },
} as const satisfies Record<string, GradientSpec>;

export const statusColors = {
  waiting: { fg: colors.slateDeep, bg: '#EEF0FA', border: colors.slate },
  washing: { fg: colors.indigoMid, bg: colors.indigoPale, border: colors.indigoBright },
  ready: { fg: colors.amberDeep, bg: colors.amberLight, border: colors.amber },
  paid: { fg: colors.tealDeep, bg: colors.tealPale, border: colors.teal },
  void: { fg: colors.slateDeep, bg: '#EEF0FA', border: colors.slate },
} as const;

export type ColorToken = keyof typeof colors;
