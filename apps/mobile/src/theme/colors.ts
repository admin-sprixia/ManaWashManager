/**
 * MANA's design system palette — a water/ocean family (blues → teals), with one deliberate
 * warm accent (amber) reserved for "needs attention" states. Every screen composes from these
 * tokens, never a one-off hex value, so the whole app reads as one system and stays trivially
 * re-themeable later (e.g. a white-label brand swap at V4 touches this file only).
 */
export const colors = {
  // Surfaces
  white: '#FFFFFF',
  surface: '#F6FAFD', // faint blue-white — cards and inputs sit on this against a pure-white screen
  surfaceRaised: '#FFFFFF', // cards that need to pop off `surface` use pure white + shadow

  // Water blues — brand, primary actions
  waterPale: '#E0F2FE',
  waterLight: '#7DD3FC',
  water: '#0EA5E9',
  waterDeep: '#0369A1',
  waterInk: '#0C4A6E', // body text on white — reads as "ink", not pure black
  waterMidnight: '#082F49', // hero gradient's deepest stop

  // Teal — a second water-family hue, used for success/paid and to add depth to gradients
  tealLight: '#5EEAD4',
  teal: '#0D9488',
  tealDeep: '#115E59',

  // Amber — the one warm accent in the whole palette, reserved for "ready / needs attention"
  amberLight: '#FDE68A',
  amber: '#F59E0B',
  amberDeep: '#B45309',

  // Neutral — waiting / inactive states, secondary text
  slate: '#94A3B8',
  slateDeep: '#475569',

  danger: '#DC2626',
  border: '#DBEAFE',
  shadow: '#0C4A6E',
} as const;

/** Named gradients — always [start, end] or [start, mid, end], light-to-dark, top-to-bottom or
 * diagonal depending on where it's used. Keeping them centrally named (not inlined per screen)
 * is what makes a future brand swap a one-file change. */
export const gradients = {
  // Fresh sky → water → deep — airy wash-bay feel, not a heavy navy slab
  hero: [colors.waterLight, colors.water, colors.waterDeep] as const,
  primaryButton: [colors.water, colors.waterDeep] as const,
  primaryButtonPressed: [colors.waterDeep, colors.waterMidnight] as const,
  success: [colors.tealLight, colors.teal] as const,
  card: [colors.white, colors.surface] as const,
  chipSelected: [colors.water, colors.waterDeep] as const,
  fab: [colors.water, colors.waterDeep] as const,
} as const;

export const statusColors = {
  waiting: { fg: colors.slateDeep, bg: '#F1F5F9', border: colors.slate },
  washing: { fg: colors.waterDeep, bg: colors.waterPale, border: colors.water },
  ready: { fg: colors.amberDeep, bg: colors.amberLight, border: colors.amber },
  paid: { fg: colors.tealDeep, bg: '#CCFBF1', border: colors.teal },
  void: { fg: colors.slateDeep, bg: '#F1F5F9', border: colors.slate },
} as const;

export type ColorToken = keyof typeof colors;
