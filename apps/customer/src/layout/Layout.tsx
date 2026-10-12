import React, { type PropsWithChildren } from 'react';
import {
  StyleSheet,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

/** Narrowest side, in dp, from which the app uses its tablet layout. */
const TABLET_MIN = 600;

/** Every page on a tablet is one centred column of this width, so all screens line up. */
export const PAGE_MAX = 640;

export function useIsTablet(): boolean {
  const { width, height } = useWindowDimensions();
  return Math.min(width, height) >= TABLET_MIN;
}

/** Caps content at the page width and centres it on tablets; a plain wrapper on phones. */
export function Page({ style, children }: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  const tablet = useIsTablet();
  return <View style={[tablet && styles.page, style]}>{children}</View>;
}

/** The same cap-and-centre as <Page>, for a scroll view's contentContainerStyle. */
export function usePageStyle(): StyleProp<ViewStyle> {
  return useIsTablet() ? styles.page : undefined;
}

const styles = StyleSheet.create({
  page: { width: '100%', maxWidth: PAGE_MAX, alignSelf: 'center' },
});
