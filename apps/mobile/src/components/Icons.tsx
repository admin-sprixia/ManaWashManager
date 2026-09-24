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
      <Path
        d="M5 16 L7 10 H17 L19 16"
        stroke={color}
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
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
      <Path
        d="M12 3 C12 3 6 10 6 14.5 A6 6 0 0 0 18 14.5 C18 10 12 3 12 3 Z"
        fill={color}
      />
    </Svg>
  );
}

/** Official-feeling WhatsApp glyph — green bubble with phone. */
export function IconWhatsApp({ size = 18, color = '#25D366' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 2.5 C6.76 2.5 2.5 6.56 2.5 11.55 C2.5 13.25 3 14.85 3.9 16.2 L2.6 21 L7.6 19.75 C8.9 20.5 10.4 20.95 12 20.95 C17.24 20.95 21.5 16.9 21.5 11.9 C21.5 6.9 17.24 2.5 12 2.5 Z"
        fill={color}
      />
      <Path
        d="M9.3 8.4 C9.1 7.95 8.85 7.95 8.65 7.95 C8.45 7.95 8.1 8 7.85 8.3 C7.6 8.6 6.9 9.25 6.9 10.6 C6.9 11.95 7.85 13.25 8 13.4 C8.15 13.55 10 16.5 12.9 17.7 C15.3 18.7 15.8 18.5 16.3 18.45 C16.8 18.4 17.9 17.8 18.15 17.15 C18.4 16.5 18.4 15.95 18.3 15.8 C18.2 15.65 18 15.55 17.7 15.4 C17.4 15.25 16.05 14.6 15.8 14.5 C15.55 14.4 15.35 14.45 15.2 14.8 C15.05 15.15 14.55 15.75 14.4 15.9 C14.25 16.05 14.1 16.1 13.8 15.95 C13.5 15.8 12.55 15.5 11.4 14.5 C10.5 13.7 9.9 12.75 9.75 12.45 C9.6 12.15 9.75 12 9.9 11.85 C10.05 11.7 10.2 11.5 10.35 11.3 C10.5 11.1 10.55 10.95 10.65 10.75 C10.75 10.55 10.7 10.35 10.65 10.2 C10.6 10.05 10.05 8.7 9.85 8.25 L9.3 8.4 Z"
        fill="#FFFFFF"
      />
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
      <Path d="M8 11 L12 15 L16 11" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M5 19 H19" stroke={color} strokeWidth={2.2} strokeLinecap="round" />
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
