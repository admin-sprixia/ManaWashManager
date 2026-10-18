import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { START_COMMUNITY_AT } from '@mana/domain';
import { IconChevronRight, IconMapPin, colors, typography } from '@mana/ui';
import { BoardSectionHeader } from '../../../components/board/BoardSectionHeader';
import type { Demand } from '../shared';
import { ActionPill, PanelRow, QuietRow, TEAL, TEAL_PALE, plural } from './parts';
import type { Nav } from './types';

/** How close an area is to having enough neighbours to start: one dot per request asked. */
function Dots({ n }: { n: number }) {
  return (
    <View style={styles.dots}>
      {Array.from({ length: START_COMMUNITY_AT }, (_, i) => (
        <View key={i} style={[styles.dot, i < n && styles.dotOn]} />
      ))}
      <Text style={styles.dotsText}>
        {n >= START_COMMUNITY_AT ? 'Enough to start' : `${START_COMMUNITY_AT - n} more to start`}
      </Text>
    </View>
  );
}

/** Where people asked for Mana Wash in the app, biggest areas first. */
export function PeopleAskingSection({ demand, nav }: { demand: Demand | null; nav: Nav }) {
  const clusters = (demand?.clusters ?? []).slice(0, 3);
  const total = (demand?.clusters ?? []).reduce((n, c) => n + c.requests, 0) + (demand?.byArea ?? []).reduce((n, a) => n + a.requests, 0);

  return (
    <View>
      <BoardSectionHeader
        title="People asking"
        count={total || undefined}
        action={total ? { label: 'See all', onPress: () => nav.navigate('PlaceDemand') } : undefined}
      />
      {clusters.length ? (
        clusters.map((c, i) => {
          const ready = c.requests >= START_COMMUNITY_AT;
          const vehicles = [c.cars ? plural(c.cars, 'car') : null, c.bikes ? plural(c.bikes, 'bike') : null].filter(Boolean).join(', ');
          return (
            <PanelRow
              key={c.requestIds[0]}
              first={i === 0}
              leading={
                <View style={[styles.pin, ready && styles.pinReady]}>
                  <IconMapPin size={19} color={ready ? colors.white : TEAL} />
                </View>
              }
              title={c.landmarks[0] ?? 'Near a pinned spot'}
              meta={`${plural(c.requests, 'request')}${vehicles ? ` · ${vehicles}` : ''}`}
              right={
                ready ? (
                  <ActionPill label="Start" onPress={() => nav.navigate('CommunitySetup', { at: c.center, label: c.landmarks[0] ?? undefined })} />
                ) : (
                  <IconChevronRight size={18} color={colors.slate} />
                )
              }
              footer={<Dots n={c.requests} />}
              onPress={() => nav.navigate('PlaceDemand')}
            />
          );
        })
      ) : (
        <QuietRow first title="Nobody waiting right now" body="When people ask in the Mana Wash app, their areas show here." />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  pin: { width: 46, height: 46, borderRadius: 23, backgroundColor: TEAL_PALE, alignItems: 'center', justifyContent: 'center' },
  pinReady: { backgroundColor: colors.teal },
  dots: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dot: { width: 14, height: 6, borderRadius: 3, backgroundColor: '#E2E8F0' },
  dotOn: { backgroundColor: colors.teal },
  dotsText: { ...typography.caption, fontSize: 11.5, fontWeight: '700', color: TEAL, letterSpacing: 0, marginLeft: 4 },
});
