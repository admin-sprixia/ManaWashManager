import React from 'react';
import { Animated, RefreshControl, StatusBar, StyleSheet, Text, View } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Notice, colors } from '@mana/ui';
import type { Branch, LiveWash, Vehicle, Wash } from '../api/types';
import { FreeWashCard } from '../components/FreeWashCard';
import { HomeHero } from '../components/HomeHero';
import { HomeSkeleton } from '../components/HomeSkeleton';
import { HelpCard, InvitePromo } from '../components/InvitePromo';
import { LatestWashCard } from '../components/LatestWashCard';
import { LiveWashCard } from '../components/LiveWashCard';
import { MessageCard } from '../components/MessageCard';
import { GiftTicket, OfferTicket } from '../components/OfferTicket';

const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

/** The small uppercase title above a group of cards. */
function SectionTitle({ children }: { children: string }) {
  return (
    <Text style={styles.sectionTitle} accessibilityRole="header">
      {children}
    </Text>
  );
}

export interface HomeViewProps {
  greeting: string;
  firstName?: string;
  branchLine: string;
  referralOffer: string;
  now: Date;
  /** The latest wash, or null when there is none yet. */
  latest: Wash | null;
  vehicles: Vehicle[];
  liveWashes: LiveWash[];
  branchOf: (id: string) => Branch | undefined;
  loading: boolean;
  refreshing: boolean;
  /** The message to show for the last failed load. */
  error: string | null;
  /** True when there is data on screen from an earlier load. */
  hasData: boolean;
  focused: boolean;
  onRefresh: () => void;
  onRetry: () => void;
  onProfile: () => void;
  onOpenWash: (id: string) => void;
  onSeeAllWashes: () => void;
  onInvite: () => void;
  onHelp: () => void;
}

/** Home as pure layout: the hero, today's wash, the latest wash, free-wash cards, offers and the invite card. */
export function HomeView(p: HomeViewProps) {
  const insets = useSafeAreaInsets();
  const liveWashes = p.liveWashes;
  const latestIsLive = p.latest != null && liveWashes.some((l) => l.id === p.latest!.id);
  const cards = p.vehicles.flatMap((v) =>
    v.cards.filter((c) => c.stamps > 0 || c.free > 0).map((c) => ({ card: c, plate: v.registrationNumber })),
  );
  const offers = p.vehicles.flatMap((v) => v.offers.map((o) => ({ ...o, plate: v.registrationNumber })));
  const gifts = p.vehicles.flatMap((v) => v.giftsOwed.map((g) => ({ ...g, plate: v.registrationNumber })));
  const freeReady = cards.reduce((n, c) => n + c.card.free, 0);

  // Only the first card under the hero overlaps it.
  const hasLive = liveWashes.length > 0;
  const staleNotice = Boolean(p.error && p.hasData);
  const overlapNext = !hasLive && !staleNotice;

  // A scrim behind the status bar fades in once content scrolls under it, so the clock stays readable.
  const scrollY = React.useRef(new Animated.Value(0)).current;
  const scrimOpacity = scrollY.interpolate({ inputRange: [0, 24, 56], outputRange: [0, 0, 1], extrapolate: 'clamp' });

  return (
    <View style={styles.screen}>
      {p.focused ? <StatusBar barStyle="light-content" /> : null}
      <Animated.ScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        scrollEventThrottle={16}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })}
        refreshControl={
          <RefreshControl
            refreshing={p.refreshing}
            onRefresh={p.onRefresh}
            progressViewOffset={insets.top}
            colors={[colors.indigo]}
            tintColor={colors.white}
          />
        }
      >
        <HomeHero
          greeting={p.greeting}
          name={p.firstName}
          branch={p.branchLine}
          freeText={freeReady > 0 ? (freeReady === 1 ? 'You have a free wash' : `You have ${freeReady} free washes`) : undefined}
          onProfile={p.onProfile}
          overlap={!staleNotice}
        />

        {hasLive ? (
          <View style={styles.live}>
            {liveWashes.map((w, i) => (
              <LiveWashCard
                key={w.id}
                wash={w}
                branch={p.branchOf(w.branch.id)}
                overlap={i === 0}
                onPress={() => p.onOpenWash(w.id)}
              />
            ))}
          </View>
        ) : null}

        {p.loading ? (
          <HomeSkeleton overlap={overlapNext} />
        ) : p.error && !p.hasData ? (
          <MessageCard
            overlap={overlapNext}
            title="Couldn’t load your washes"
            body={p.error}
            action={{ label: 'Try again', onPress: p.onRetry }}
          />
        ) : (
          <>
            {staleNotice ? (
              <View style={styles.notice}>
                <Notice tone="warning">{p.error!}</Notice>
              </View>
            ) : null}

            {p.latest && !latestIsLive ? (
              <LatestWashCard
                wash={p.latest}
                overlap={overlapNext}
                onPress={() => p.onOpenWash(p.latest!.id)}
                onSeeAll={p.onSeeAllWashes}
              />
            ) : !p.latest ? (
              <MessageCard
                overlap={overlapNext}
                title="No washes yet"
                body="Your washes and their photos will show here after your first visit."
              />
            ) : null}

            {cards.length > 0 ? (
              <>
                <SectionTitle>Free-wash cards</SectionTitle>
                <View style={styles.stack}>
                  {cards.map(({ card, plate }) => (
                    <FreeWashCard
                      key={`${plate}:${card.serviceName}`}
                      card={card}
                      now={p.now}
                      vehicle={p.vehicles.length > 1 ? plate : undefined}
                    />
                  ))}
                </View>
              </>
            ) : null}

            {offers.length > 0 || gifts.length > 0 ? (
              <>
                <SectionTitle>Waiting for you</SectionTitle>
                {offers.map((o) => (
                  <OfferTicket key={o.code} percent={o.percent} plate={o.plate} code={o.code} till={shortDate(o.expiresAt)} />
                ))}
                {gifts.map((g, i) => (
                  <GiftTicket
                    key={`${g.plate}:${g.itemName}:${i}`}
                    plate={g.plate}
                    item={g.quantity > 1 ? `${g.itemName} × ${g.quantity}` : g.itemName}
                  />
                ))}
              </>
            ) : null}

            <SectionTitle>More from MANA</SectionTitle>
            <InvitePromo offer={p.referralOffer} onPress={p.onInvite} />
            <HelpCard onPress={p.onHelp} />
          </>
        )}
      </Animated.ScrollView>

      <Animated.View pointerEvents="none" style={[styles.scrim, { height: insets.top + 8, opacity: scrimOpacity }]}>
        <LinearGradient
          colors={['rgba(58,77,176,0.97)', 'rgba(58,77,176,0.9)', 'rgba(58,77,176,0)']}
          locations={[0, 0.62, 1]}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  content: { paddingBottom: 32 },
  live: { gap: 12 },
  stack: { gap: 12 },
  notice: { paddingHorizontal: 16, paddingTop: 16 },
  sectionTitle: {
    marginTop: 26,
    marginBottom: 10,
    marginHorizontal: 20,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.slateDeep,
  },
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 5 },
});
