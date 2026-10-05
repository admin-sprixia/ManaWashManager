import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, View, type ImageStyle, type StyleProp } from 'react-native';
import { IconImage, colors } from '@mana/ui';
import { photoSource } from '../api/client';

interface PhotoImageProps {
  photoId: string;
  style: StyleProp<ImageStyle>;
  resizeMode?: 'cover' | 'contain';
  /** Spinner and placeholder colours on a dark background (the full-screen viewer). */
  dark?: boolean;
}

/** A wash photo, fetched with this customer's token (photos are private). */
export function PhotoImage({ photoId, style, resizeMode = 'cover', dark }: PhotoImageProps) {
  const [source, setSource] = useState<{ uri: string; headers: Record<string, string> } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void photoSource(photoId).then((s) => !cancelled && setSource(s));
    return () => {
      cancelled = true;
    };
  }, [photoId]);

  return (
    <View style={[style, styles.frame, dark && styles.dark]}>
      {source && !failed ? (
        <Image
          source={source}
          style={StyleSheet.absoluteFill}
          resizeMode={resizeMode}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          accessibilityIgnoresInvertColors
        />
      ) : null}
      {failed ? (
        <IconImage size={28} color={dark ? colors.slateDeep : colors.slate} />
      ) : !loaded ? (
        <ActivityIndicator color={dark ? colors.white : colors.water} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden', backgroundColor: colors.waterPale },
  dark: { backgroundColor: 'transparent' },
});
