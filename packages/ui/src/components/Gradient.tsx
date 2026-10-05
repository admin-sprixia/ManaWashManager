import React, { type PropsWithChildren } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import type { GradientSpec } from '../theme';

interface GradientProps extends PropsWithChildren {
  spec: GradientSpec;
  style?: StyleProp<ViewStyle>;
}

/** A named gradient from the theme as a view, so screens never repeat colour lists or stop positions. */
export function Gradient({ spec, style, children }: GradientProps) {
  return (
    <LinearGradient
      colors={spec.colors as unknown as string[]}
      locations={spec.locations as unknown as number[] | undefined}
      start={spec.start}
      end={spec.end}
      style={style}
    >
      {children}
    </LinearGradient>
  );
}
