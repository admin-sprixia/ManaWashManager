import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Line } from 'react-native-svg';
import { Gradient, IconGift, brandGradients, colors, radius, shadow } from '@mana/ui';
import { copyText } from '../utils/contact';

const STUB = 92;
const NOTCH = 22;
const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });

/** A small plate chip. */
function Plate({ children }: { children: string }) {
  return (
    <View style={styles.plate}>
      <Text style={styles.plateText}>{children}</Text>
    </View>
  );
}

/** The ticket shell: a coloured stub, a dashed tear line with two notches, and the details beside it. */
function Ticket({ stub, children }: { stub: React.ReactNode; children: React.ReactNode }) {
  return (
    <View style={styles.ticket}>
      {stub}
      <View style={styles.tear} pointerEvents="none">
        <Svg width={2} height="100%">
          <Line x1="1" y1="0" x2="1" y2="100%" stroke="#D3D9F6" strokeWidth={2} strokeDasharray="4 4" />
        </Svg>
      </View>
      <View style={[styles.notch, styles.notchTop]} pointerEvents="none" />
      <View style={[styles.notch, styles.notchBottom]} pointerEvents="none" />
      <View style={styles.body}>{children}</View>
    </View>
  );
}

interface OfferTicketProps {
  percent: number;
  plate: string;
  code: string;
  /** "19 Oct" */
  till: string;
}

/** A percentage-off offer, with the code ready to copy. */
export function OfferTicket({ percent, plate, code, till }: OfferTicketProps) {
  const copy = () => copyText(code, 'Code copied');
  return (
    <Ticket
      stub={
        <Gradient spec={brandGradients.promo} style={styles.stub}>
          <Text style={styles.percent}>{percent}%</Text>
          <Text style={styles.off}>OFF</Text>
        </Gradient>
      }
    >
      <Text style={styles.title}>{percent}% off your next wash</Text>
      <View style={styles.chips}>
        <Plate>{plate}</Plate>
        <View style={styles.till}>
          <Text style={styles.tillText}>Till {till}</Text>
        </View>
      </View>
      <View style={styles.code}>
        <Text style={styles.codeText} numberOfLines={1}>
          {code}
        </Text>
        <Pressable
          onPress={copy}
          hitSlop={8}
          style={({ pressed }) => [styles.copy, pressed && styles.copyPressed]}
          accessibilityRole="button"
          accessibilityLabel={`Copy code ${code}`}
        >
          <Text style={styles.copyText}>Copy</Text>
        </Pressable>
      </View>
    </Ticket>
  );
}

interface GiftTicketProps {
  plate: string;
  /** "Car perfume × 2" */
  item: string;
}

/** A gift waiting to be collected on the next visit. */
export function GiftTicket({ plate, item }: GiftTicketProps) {
  return (
    <Ticket
      stub={
        <Gradient spec={brandGradients.gold} style={styles.stub}>
          <IconGift size={30} color={colors.goldInk} />
          <Text style={[styles.off, styles.giftLabel]}>GIFT</Text>
        </Gradient>
      }
    >
      <Text style={styles.title}>A gift for {plate}</Text>
      <Text style={styles.giftMeta}>{item} · collect it on your next visit</Text>
    </Ticket>
  );
}

const styles = StyleSheet.create({
  ticket: {
    marginHorizontal: 16,
    marginBottom: 12,
    flexDirection: 'row',
    borderRadius: radius.lg,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: '#E9EDFC',
    ...shadow('md'),
  },
  stub: {
    width: STUB,
    alignItems: 'center',
    justifyContent: 'center',
    borderTopLeftRadius: radius.lg - 1,
    borderBottomLeftRadius: radius.lg - 1,
  },
  percent: { fontSize: 30, lineHeight: 32, fontWeight: '800', letterSpacing: -1, color: colors.white },
  off: { fontSize: 11, fontWeight: '800', letterSpacing: 1.6, color: 'rgba(255,255,255,0.9)', marginTop: 3 },
  giftLabel: { color: colors.goldInk },
  tear: { position: 'absolute', left: STUB - 1, top: 0, bottom: 0, width: 2 },
  // Half-discs cut into the card at the top and bottom of the tear line, in the screen colour.
  notch: { position: 'absolute', left: STUB - NOTCH / 2, width: NOTCH, height: NOTCH / 2, backgroundColor: colors.surface, zIndex: 2 },
  notchTop: { top: 0, borderBottomLeftRadius: NOTCH / 2, borderBottomRightRadius: NOTCH / 2 },
  notchBottom: { bottom: 0, borderTopLeftRadius: NOTCH / 2, borderTopRightRadius: NOTCH / 2 },
  body: { flex: 1, minWidth: 0, paddingTop: 14, paddingBottom: 14, paddingLeft: 18, paddingRight: 16 },
  title: { fontSize: 16.5, fontWeight: '700', color: colors.ink, letterSpacing: -0.1 },
  chips: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  plate: { paddingVertical: 2, paddingHorizontal: 8, borderRadius: 7, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  plateText: { fontSize: 11.5, fontWeight: '800', letterSpacing: 0.8, color: colors.slateDeep },
  till: { paddingVertical: 2, paddingHorizontal: 9, borderRadius: radius.pill, backgroundColor: colors.indigoPale },
  tillText: { fontSize: 12.5, fontWeight: '700', color: colors.indigoMid },
  code: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
    paddingVertical: 7,
    paddingLeft: 11,
    paddingRight: 8,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#B9C4F2',
    borderRadius: 11,
    backgroundColor: '#F7F8FF',
  },
  codeText: { flex: 1, fontFamily: MONO, fontSize: 12.5, fontWeight: '700', letterSpacing: 0.4, color: colors.indigoMid },
  copy: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 8, backgroundColor: colors.indigoPale },
  copyPressed: { backgroundColor: colors.indigoMist },
  copyText: { fontSize: 12, fontWeight: '800', color: colors.indigoMid },
  giftMeta: { fontSize: 13.5, color: colors.slateDeep, marginTop: 5 },
});
