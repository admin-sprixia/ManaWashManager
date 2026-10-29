import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Avatar, ScreenContainer, ScreenHeader, IconWhatsApp, colors, radius, spacing, typography } from '@mana/ui';
import { ScreenHero } from '../components/ScreenChrome';
import { api, apiErrorMessage } from '../api/client';
import { formatPhone, inboxTime } from '../utils/inbox';
import type { RootStackParamList } from '../navigation/RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'Inbox'>;

interface Conversation {
  phone: string;
  name: string | null;
  awaitingSince: string | null;
  canReply: boolean;
  last: { fromCustomer: boolean; text: string; at: string } | null;
}

/** While the inbox is open it refreshes on its own, so a new question shows up without pulling. */
const REFRESH_MS = 20_000;

/**
 * WhatsApp conversations on the business number. Customers the assistant couldn't answer (a
 * question, a photo, a voice note) are on top under "Needs reply"; tap one to answer it from
 * 91547 52999.
 */
export function InboxScreen({ navigation }: Props) {
  const [tab, setTab] = useState<'waiting' | 'all'>('waiting');
  const [items, setItems] = useState<Conversation[] | null>(null);
  const [waiting, setWaiting] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const tabRef = useRef(tab);
  tabRef.current = tab;

  const load = useCallback(async () => {
    try {
      const [list, count] = await Promise.all([
        api.whatsapp.inbox.$get({ query: tabRef.current === 'waiting' ? { waiting: '1' } : {} }),
        api.whatsapp.inbox.count.$get(),
      ]);
      if (!list.ok) {
        setError(await apiErrorMessage(list, 'Couldn’t load the inbox.'));
        return;
      }
      const data = await list.json();
      if ('conversations' in data) setItems(data.conversations);
      if (count.ok) setWaiting((await count.json()).waiting);
      setError(null);
    } catch {
      setError('You’re offline. The inbox needs a connection.');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
      const timer = setInterval(() => void load(), REFRESH_MS);
      return () => clearInterval(timer);
    }, [load]),
  );
  useEffect(() => {
    setItems(null);
    void load();
  }, [tab, load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const header = (
    <>
      <ScreenHero
        eyebrow="WhatsApp · 91547 52999"
        title={waiting > 0 ? `${waiting} waiting for a reply` : 'All answered'}
        meta="Questions the assistant couldn’t answer land here. Reply within 24 hours of their last message."
        alert={waiting > 0}
      />
      <View style={styles.tabs}>
        {(['waiting', 'all'] as const).map((t) => (
          <Pressable key={t} onPress={() => setTab(t)} style={[styles.tab, tab === t && styles.tabOn]}>
            <Text style={[styles.tabText, tab === t && styles.tabTextOn]}>
              {t === 'waiting' ? `Needs reply${waiting > 0 ? ` · ${waiting}` : ''}` : 'All chats'}
            </Text>
          </Pressable>
        ))}
      </View>
    </>
  );

  return (
    <ScreenContainer noPadding>
      <View style={styles.headerPad}>
        <ScreenHeader title="WhatsApp inbox" onBack={() => navigation.goBack()} />
      </View>
      {!items ? (
        <View style={styles.center}>
          {error ? (
            <>
              <Text style={styles.emptyTitle}>Couldn’t load the inbox</Text>
              <Text style={styles.emptyBody}>{error}</Text>
              <Pressable onPress={() => void load()} style={styles.retryBtn}>
                <Text style={styles.retryText}>Retry</Text>
              </Pressable>
            </>
          ) : (
            <ActivityIndicator color={colors.water} size="large" />
          )}
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(c) => c.phone}
          ListHeaderComponent={header}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={colors.water} colors={[colors.water]} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <IconWhatsApp size={34} />
              <Text style={styles.emptyTitle}>{tab === 'waiting' ? 'Nobody is waiting' : 'No chats yet'}</Text>
              <Text style={styles.emptyBody}>
                {tab === 'waiting'
                  ? 'When a customer asks something the assistant can’t answer, it shows up here.'
                  : 'Customers who message 91547 52999 show up here.'}
              </Text>
            </View>
          }
          renderItem={({ item, index }) => (
            <Pressable
              onPress={() => navigation.navigate('Conversation', { phone: item.phone, name: item.name })}
              style={({ pressed }) => [styles.row, index > 0 && styles.rowBorder, pressed && styles.pressed]}
            >
              <Avatar name={item.name ?? item.phone} id={item.phone} size={44} />
              <View style={styles.rowCopy}>
                <View style={styles.rowTop}>
                  <Text style={styles.rowName} numberOfLines={1}>
                    {item.name ?? formatPhone(item.phone)}
                  </Text>
                  {item.last ? <Text style={[styles.rowTime, !!item.awaitingSince && styles.rowTimeWaiting]}>{inboxTime(item.last.at)}</Text> : null}
                </View>
                <Text style={[styles.rowLast, !!item.awaitingSince && !!item.last?.fromCustomer && styles.rowLastWaiting]} numberOfLines={2}>
                  {item.last ? `${item.last.fromCustomer ? '' : 'You: '}${item.last.text}` : formatPhone(item.phone)}
                </Text>
                <View style={styles.tags}>
                  {item.awaitingSince ? (
                    <View style={[styles.tag, styles.tagWaiting]}>
                      <Text style={[styles.tagText, styles.tagTextWaiting]}>Needs reply</Text>
                    </View>
                  ) : null}
                  {!item.canReply ? (
                    <View style={styles.tag}>
                      <Text style={styles.tagText}>24h window closed</Text>
                    </View>
                  ) : null}
                </View>
              </View>
            </Pressable>
          )}
        />
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  headerPad: { paddingHorizontal: spacing.md },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg, gap: spacing.sm },
  list: { paddingBottom: spacing.xl * 2 },
  tabs: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.md, marginTop: spacing.md, marginBottom: spacing.sm },
  tab: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: colors.indigoPale },
  tabOn: { backgroundColor: colors.indigo },
  tabText: { ...typography.label, color: colors.slateDeep, fontSize: 13 },
  tabTextOn: { color: colors.white },
  row: { flexDirection: 'row', gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: 14, backgroundColor: colors.white },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  pressed: { opacity: 0.7 },
  rowCopy: { flex: 1, gap: 3 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowName: { ...typography.bodyStrong, flex: 1, color: colors.ink, fontSize: 15.5 },
  rowTime: { ...typography.caption, color: colors.slate, fontSize: 12 },
  rowTimeWaiting: { color: '#0F7A3D', fontWeight: '700' },
  rowLast: { ...typography.body, color: colors.slateDeep, fontSize: 14, lineHeight: 19 },
  rowLastWaiting: { color: colors.ink, fontWeight: '600' },
  tags: { flexDirection: 'row', gap: 6, marginTop: 2 },
  tag: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: colors.indigoPale },
  tagText: { ...typography.caption, color: colors.slateDeep, fontSize: 11.5, fontWeight: '600' },
  tagWaiting: { backgroundColor: '#DCFCE7' },
  tagTextWaiting: { color: '#0F7A3D' },
  empty: { alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.xl, paddingTop: spacing.xl * 1.5 },
  emptyTitle: { ...typography.bodyStrong, color: colors.ink, fontSize: 16, textAlign: 'center' },
  emptyBody: { ...typography.body, color: colors.slateDeep, textAlign: 'center' },
  retryBtn: { marginTop: spacing.sm, paddingHorizontal: 18, paddingVertical: 10, borderRadius: radius.pill, backgroundColor: colors.indigo },
  retryText: { ...typography.label, color: colors.white },
});
