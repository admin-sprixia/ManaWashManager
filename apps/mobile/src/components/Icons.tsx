import React from 'react';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

type IconProps = {
  size?: number;
  color?: string;
};

/** Crisp outline icons shared across Job Board, Customer Profile, and Settings.
 * Stroke-based (not emoji) so size/weight stay consistent on every Android density. */
export function IconChevronLeft({ size = 22, color = '#0369A1' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M15 6 L9 12 L15 18"
        stroke={color}
        strokeWidth={2.25}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function IconChart({ size = 20, color = '#FFFFFF' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M4 19 V13" stroke={color} strokeWidth={2.2} strokeLinecap="round" />
      <Path d="M10 19 V8" stroke={color} strokeWidth={2.2} strokeLinecap="round" />
      <Path d="M16 19 V5" stroke={color} strokeWidth={2.2} strokeLinecap="round" />
      <Path d="M22 19 V11" stroke={color} strokeWidth={2.2} strokeLinecap="round" />
    </Svg>
  );
}

export function IconSettings({ size = 20, color = '#FFFFFF' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={3} stroke={color} strokeWidth={2} />
      <Path
        d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.09a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
        stroke={color}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function IconPlus({ size = 20, color = '#FFFFFF' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 5 V19" stroke={color} strokeWidth={2.4} strokeLinecap="round" />
      <Path d="M5 12 H19" stroke={color} strokeWidth={2.4} strokeLinecap="round" />
    </Svg>
  );
}

export function IconPhone({ size = 18, color = '#0369A1' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function IconCar({ size = 18, color = '#0369A1' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M5 16 L7 10 H17 L19 16" stroke={color} strokeWidth={1.8} strokeLinejoin="round" />
      <Path d="M3 16 H21" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
      <Path d="M5 16 V18" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
      <Path d="M19 16 V18" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
      <Circle cx={7.5} cy={16} r={1.4} fill={color} />
      <Circle cx={16.5} cy={16} r={1.4} fill={color} />
    </Svg>
  );
}

export function IconPerson({ size = 22, color = '#0369A1' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={8} r={3.5} stroke={color} strokeWidth={1.8} />
      <Path
        d="M5.5 19.5 C5.5 16.5 8.3 14.5 12 14.5 C15.7 14.5 18.5 16.5 18.5 19.5"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </Svg>
  );
}

export function IconCalendar({ size = 18, color = '#0369A1' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x={3.5} y={5} width={17} height={15} rx={2.5} stroke={color} strokeWidth={1.8} />
      <Path d="M3.5 10 H20.5" stroke={color} strokeWidth={1.8} />
      <Path d="M8 3.5 V7" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
      <Path d="M16 3.5 V7" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
    </Svg>
  );
}

export function IconRupee({ size = 18, color = '#0369A1' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M7 6 H17" stroke={color} strokeWidth={2} strokeLinecap="round" />
      <Path d="M7 10 H17" stroke={color} strokeWidth={2} strokeLinecap="round" />
      <Path
        d="M9 6 C13 6 15 9 12.5 12 L7 18"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function IconVisits({ size = 18, color = '#0369A1' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M8 6 H16 A2 2 0 0 1 18 8 V18 A2 2 0 0 1 16 20 H8 A2 2 0 0 1 6 18 V8 A2 2 0 0 1 8 6 Z"
        stroke={color}
        strokeWidth={1.8}
      />
      <Path d="M9 10 H15" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
      <Path d="M9 14 H13" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
    </Svg>
  );
}

export function IconPlay({ size = 16, color = '#FFFFFF' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M8 5.5 L19 12 L8 18.5 Z" fill={color} />
    </Svg>
  );
}

export function IconCheck({ size = 16, color = '#FFFFFF' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M5 12.5 L10 17.5 L19 7"
        stroke={color}
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function IconDroplet({ size = 16, color = '#FFFFFF' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 3 C12 3 6 10 6 14.5 A6 6 0 0 0 18 14.5 C18 10 12 3 12 3 Z" fill={color} />
    </Svg>
  );
}

/** Official-feeling WhatsApp glyph — green bubble with phone. */
// Official WhatsApp glyph geometry (Simple Icons, CC0): handset + ring + outer bubble.
const WHATSAPP_GLYPH =
  'M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z';
const WHATSAPP_BUBBLE =
  'M20.464 3.488A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z';

/**
 * WhatsApp mark. `brand` (default) is the official logo — green bubble, white ring and handset.
 * `mono` draws the glyph in a single `color`, for placing on a green or dark button.
 */
export function IconWhatsApp({
  size = 18,
  color = '#FFFFFF',
  variant = 'brand',
}: IconProps & { variant?: 'brand' | 'mono' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {variant === 'brand' ? <Path d={WHATSAPP_BUBBLE} fill="#25D366" /> : null}
      <Path d={WHATSAPP_GLYPH} fill={variant === 'brand' ? '#FFFFFF' : color} />
    </Svg>
  );
}

export function IconSparkle({ size = 28, color = '#0EA5E9' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 3 L13.8 9.2 L20 11 L13.8 12.8 L12 19 L10.2 12.8 L4 11 L10.2 9.2 Z"
        fill={color}
      />
    </Svg>
  );
}

export function IconDownload({ size = 20, color = '#FFFFFF' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 4 V14" stroke={color} strokeWidth={2.2} strokeLinecap="round" />
      <Path
        d="M8 11 L12 15 L16 11"
        stroke={color}
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path d="M5 19 H19" stroke={color} strokeWidth={2.2} strokeLinecap="round" />
    </Svg>
  );
}

export function IconChevronRight({ size = 18, color = '#94A3B8' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M9 6 L15 12 L9 18"
        stroke={color}
        strokeWidth={2.25}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function IconGrid({ size = 20, color = '#FFFFFF' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x={4} y={4} width={6.5} height={6.5} rx={1.8} stroke={color} strokeWidth={2} />
      <Rect x={13.5} y={4} width={6.5} height={6.5} rx={1.8} stroke={color} strokeWidth={2} />
      <Rect x={4} y={13.5} width={6.5} height={6.5} rx={1.8} stroke={color} strokeWidth={2} />
      <Rect x={13.5} y={13.5} width={6.5} height={6.5} rx={1.8} stroke={color} strokeWidth={2} />
    </Svg>
  );
}

export function IconUsers({ size = 20, color = '#0369A1' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={9} cy={8.5} r={3.2} stroke={color} strokeWidth={1.8} />
      <Path
        d="M3 19 C3 16.2 5.7 14.4 9 14.4 C12.3 14.4 15 16.2 15 19"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
      <Path
        d="M15.5 5.6 A3 3 0 0 1 15.5 11.4"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
      <Path
        d="M17.5 14.7 C19.6 15.3 21 16.9 21 19"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </Svg>
  );
}

export function IconReceipt({ size = 20, color = '#0369A1' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M6 3.5 H18 V20.5 L15.5 19 L13 20.5 L10.5 19 L8 20.5 L6 19.2 Z"
        stroke={color}
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
      <Path d="M9 8 H15" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
      <Path d="M9 11.5 H15" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
      <Path d="M9 15 H12.5" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
    </Svg>
  );
}

export function IconShield({ size = 20, color = '#0369A1' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 3 L19.5 6 V11.5 C19.5 16 16.4 19.6 12 21 C7.6 19.6 4.5 16 4.5 11.5 V6 Z"
        stroke={color}
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
      <Path
        d="M8.8 12 L11 14.2 L15.4 9.8"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function IconLock({ size = 20, color = '#0369A1' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x={5} y={10.5} width={14} height={10} rx={2.5} stroke={color} strokeWidth={1.8} />
      <Path
        d="M8 10.5 V7.5 A4 4 0 0 1 16 7.5 V10.5"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
      <Circle cx={12} cy={15.5} r={1.4} fill={color} />
    </Svg>
  );
}

export function IconLogout({ size = 20, color = '#DC2626' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M14 4 H18 A2 2 0 0 1 20 6 V18 A2 2 0 0 1 18 20 H14"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
      <Path
        d="M10 8 L6 12 L10 16"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path d="M6 12 H15" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
    </Svg>
  );
}

export function IconBan({ size = 18, color = '#DC2626' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={8.5} stroke={color} strokeWidth={1.9} />
      <Path d="M6 6 L18 18" stroke={color} strokeWidth={1.9} strokeLinecap="round" />
    </Svg>
  );
}

export function IconCloudOff({ size = 18, color = '#B45309' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M8 18 H17 A4 4 0 0 0 18.6 10.3 A6 6 0 0 0 7.5 8.6 A4.7 4.7 0 0 0 8 18 Z"
        stroke={color}
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
      <Path d="M4 4 L20 20" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
    </Svg>
  );
}

export function IconSync({ size = 18, color = '#0369A1' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M19.5 12 A7.5 7.5 0 0 1 6.2 16.8"
        stroke={color}
        strokeWidth={1.9}
        strokeLinecap="round"
      />
      <Path
        d="M4.5 12 A7.5 7.5 0 0 1 17.8 7.2"
        stroke={color}
        strokeWidth={1.9}
        strokeLinecap="round"
      />
      <Path
        d="M18.5 3.8 V7.6 H14.7"
        stroke={color}
        strokeWidth={1.9}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M5.5 20.2 V16.4 H9.3"
        stroke={color}
        strokeWidth={1.9}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function IconClock({ size = 16, color = '#94A3B8' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={8.5} stroke={color} strokeWidth={1.9} />
      <Path
        d="M12 7.5 V12 L15 14"
        stroke={color}
        strokeWidth={1.9}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function IconAlert({ size = 18, color = '#DC2626' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 3.5 L21 19.5 H3 Z" stroke={color} strokeWidth={1.9} strokeLinejoin="round" />
      <Path d="M12 10 V14" stroke={color} strokeWidth={1.9} strokeLinecap="round" />
      <Circle cx={12} cy={16.8} r={1.1} fill={color} />
    </Svg>
  );
}

export function IconClose({ size = 18, color = '#475569' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M6 6 L18 18" stroke={color} strokeWidth={2.2} strokeLinecap="round" />
      <Path d="M18 6 L6 18" stroke={color} strokeWidth={2.2} strokeLinecap="round" />
    </Svg>
  );
}

export function IconBackspace({ size = 24, color = '#0C4A6E' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M9 5 H19 A2 2 0 0 1 21 7 V17 A2 2 0 0 1 19 19 H9 L3 12 Z"
        stroke={color}
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
      <Path d="M11.5 9.5 L16 14" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
      <Path d="M16 9.5 L11.5 14" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
    </Svg>
  );
}

export function IconCash({ size = 22, color = '#0D9488' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x={2.5} y={6} width={19} height={12} rx={2.2} stroke={color} strokeWidth={1.8} />
      <Circle cx={12} cy={12} r={2.6} stroke={color} strokeWidth={1.8} />
      <Path d="M6 9.5 V14.5" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
      <Path d="M18 9.5 V14.5" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
    </Svg>
  );
}

export function IconUpi({ size = 22, color = '#0369A1' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x={3.5} y={3.5} width={7} height={7} rx={1.5} stroke={color} strokeWidth={1.8} />
      <Rect x={13.5} y={3.5} width={7} height={7} rx={1.5} stroke={color} strokeWidth={1.8} />
      <Rect x={3.5} y={13.5} width={7} height={7} rx={1.5} stroke={color} strokeWidth={1.8} />
      <Path
        d="M13.5 13.5 H16 V16 H13.5 Z M18 13.5 H20.5 M13.5 18 V20.5 M16.5 18 H20.5 V20.5"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function IconWallet({ size = 22, color = '#475569' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4 7 A2 2 0 0 1 6 5 H17 V8"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Rect x={4} y={8} width={16.5} height={11} rx={2.2} stroke={color} strokeWidth={1.8} />
      <Circle cx={16.2} cy={13.5} r={1.3} fill={color} />
    </Svg>
  );
}

export function IconEdit({ size = 18, color = '#0369A1' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4 20 H8 L18.5 9.5 A2.1 2.1 0 0 0 14.5 5.5 L4 16 Z"
        stroke={color}
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
      <Path d="M13 7 L17 11" stroke={color} strokeWidth={1.8} />
    </Svg>
  );
}

export function IconSearch({ size = 18, color = '#64748B' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={11} cy={11} r={6.5} stroke={color} strokeWidth={2} />
      <Path d="M16 16 L20.5 20.5" stroke={color} strokeWidth={2.2} strokeLinecap="round" />
    </Svg>
  );
}

export function IconTag({ size = 18, color = '#0369A1' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7a1 1 0 0 1 .7.3l7.8 7.8a1 1 0 0 1 0 1.4l-7.7 7.7a1 1 0 0 1-1.4 0l-7.8-7.8a1 1 0 0 1-.3-.7z"
        stroke={color}
        strokeWidth={1.9}
        strokeLinejoin="round"
      />
      <Circle cx={8.5} cy={8.5} r={1.6} fill={color} />
    </Svg>
  );
}

export function IconPlate({ size = 18, color = '#0369A1' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x={2.5} y={6.5} width={19} height={11} rx={2.2} stroke={color} strokeWidth={1.9} />
      <Path
        d="M6.5 12h2M10.5 12h2M14.5 12h3"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
      />
    </Svg>
  );
}

export function IconChevronDown({ size = 18, color = '#0369A1' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M6 9 L12 15 L18 9"
        stroke={color}
        strokeWidth={2.25}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function IconBell({ size = 20, color = '#FFFFFF' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M6 16.5 V11 a6 6 0 0 1 12 0 v5.5 l1.5 1.5 H4.5 Z"
        stroke={color}
        strokeWidth={1.9}
        strokeLinejoin="round"
      />
      <Path
        d="M10 20.5 a2.2 2.2 0 0 0 4 0"
        stroke={color}
        strokeWidth={1.9}
        strokeLinecap="round"
      />
    </Svg>
  );
}

export function IconGift({ size = 20, color = '#0369A1' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x={4} y={9} width={16} height={11} rx={1.8} stroke={color} strokeWidth={1.9} />
      <Path d="M3 9 H21 M12 9 V20" stroke={color} strokeWidth={1.9} strokeLinecap="round" />
      <Path
        d="M12 9 C12 9 11 4.5 8.3 4.5 A2.2 2.2 0 0 0 8.3 9 M12 9 C12 9 13 4.5 15.7 4.5 A2.2 2.2 0 0 1 15.7 9"
        stroke={color}
        strokeWidth={1.9}
        strokeLinecap="round"
      />
    </Svg>
  );
}
