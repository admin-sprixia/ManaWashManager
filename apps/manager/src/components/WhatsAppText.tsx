import React from 'react';
import { StyleSheet, Text, type StyleProp, type TextStyle } from 'react-native';

// WhatsApp's markers: *bold*, _italic_, ~strike~. A marker only counts when it hugs its words.
const TOKEN = /([*_~])(?=\S)([^*_~\n]*?\S)\1/g;

/** A message as WhatsApp will show it: *bold* is bold, not wrapped in asterisks. */
export function WhatsAppText({ children, style }: { children: string; style?: StyleProp<TextStyle> }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const m of children.matchAll(TOKEN)) {
    const at = m.index ?? 0;
    if (at > last) parts.push(children.slice(last, at));
    const mark = m[1];
    parts.push(
      <Text key={at} style={mark === '*' ? styles.bold : mark === '_' ? styles.italic : styles.strike}>
        {m[2]}
      </Text>,
    );
    last = at + m[0].length;
  }
  if (last < children.length) parts.push(children.slice(last));
  return <Text style={style}>{parts}</Text>;
}

const styles = StyleSheet.create({
  bold: { fontWeight: '800' },
  italic: { fontStyle: 'italic' },
  strike: { textDecorationLine: 'line-through' },
});
