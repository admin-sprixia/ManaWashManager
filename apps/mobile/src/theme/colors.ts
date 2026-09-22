/**
 * MANA's palette: white and water — nothing else. Every screen composes from these tokens
 * so the app reads as one consistent system rather than per-screen color choices.
 */
export const colors = {
  // Whites — surfaces
  white: '#FFFFFF',
  offWhite: '#F7FBFD', // faint blue-white for subtle surface separation (cards on white background)

  // Water blues — the brand color, used for actions, emphasis, and active states
  waterPale: '#E0F2FE', // pale wash for selected/hover backgrounds
  waterLight: '#7DD3FC', // light accents, disabled-but-visible states
  water: '#0EA5E9', // primary — buttons, links, active tab, focus rings
  waterDeep: '#0369A1', // pressed states, headings that need more weight
  waterInk: '#0C4A6E', // body text on white — reads as "ink", not pure black

  // Functional states stay inside the white/water palette rather than introducing new hues —
  // distinguished by weight and darkness, not color family.
  success: '#0D9488', // still a water-family teal, used for "paid" / confirmations
  warning: '#0891B2', // mid-water, used for "needs attention" (e.g. pending payment)
  danger: '#0C4A6E', // darkest ink-blue, reserved for destructive/void actions

  border: '#DBEAFE',
} as const;

export type ColorToken = keyof typeof colors;
