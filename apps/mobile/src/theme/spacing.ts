export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const radius = {
  sm: 10,
  md: 14,
  lg: 20,
  xl: 28,
  pill: 999,
} as const;

export const typography = {
  display: { fontSize: 34, fontWeight: '800' as const, letterSpacing: -0.5 },
  title: { fontSize: 26, fontWeight: '700' as const, letterSpacing: -0.3 },
  heading: { fontSize: 19, fontWeight: '700' as const },
  body: { fontSize: 16, fontWeight: '400' as const },
  bodyStrong: { fontSize: 16, fontWeight: '600' as const },
  label: { fontSize: 13, fontWeight: '600' as const, letterSpacing: 0.2 },
  caption: { fontSize: 12, fontWeight: '500' as const, letterSpacing: 0.2 },
} as const;

/** Soft, consistent elevation — used on cards and floating elements. iOS reads shadow*, Android reads elevation. */
export const shadow = (level: 'sm' | 'md' | 'lg' = 'md') => {
  const presets = {
    sm: { shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
    md: { shadowOpacity: 0.1, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 6 },
    lg: { shadowOpacity: 0.16, shadowRadius: 24, shadowOffset: { width: 0, height: 12 }, elevation: 12 },
  } as const;
  return { shadowColor: '#0C4A6E', ...presets[level] };
};
