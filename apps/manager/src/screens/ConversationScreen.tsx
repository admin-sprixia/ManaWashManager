import React, { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import Svg, { Path } from 'react-native-svg';
import { IconPhone, ScreenContainer, ScreenHeader, colors, radius, showToast, spacing, typography } from '@mana/ui';
import { api, apiErrorMessage } from '../api/client';
import { bubbleTime, formatPhone, inboxTime } from '../utils/inbox';
import type { RootStackParamList } from '../navigation/RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'Conversation'>;

interface Message {
  id: string;
  fromCustomer: boolean;
  by: string | null;
  text: string;
  status: string;
  at: string;
}
interface Thread {
  phone: string;
  name: string | null;
  awaitingSince: string | null;
  canReply: boolean;
  replyUntil: string | null;
  stoppedOffers: boolean;
  messages: Message[];
}

const REFRESH_MS = 10_000;

function SendIcon({ color }: { color: string }) {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24">
      <Path d="M3.4 20.4 21 12 3.4 3.6 3.4 10l12.6 2-12.6 2z" fill={color} />
    </Svg>
  );
}

/**
 * One customer's WhatsApp chat on the business number: everything the assistant, the automatic
 * messages and teammates sent, and a box to reply from 91547 52999. Replying takes it off the
 * waiting list and keeps the assistant quiet for two hours; "Mark done" does that without a reply.
 */
export function ConversationScreen({ navigation, route }: Props) {
  const { phone } = route.params;
  const [thread, setThread] = useState<Thread | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef<FlatList<Message>>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.whatsapp.inbox[':phone'].$get({ param: { phone } });
      if (!res.ok) {
        setError(await apiErrorMessage(res, 'Couldn’t load this chat.'));
        return;
      }
      const data = await res.json();
      if ('messages' in data) setThread(data);
      setError(null);
    } catch {
      setError('You’re offline. Chats need a connection.');
    }
  }, [phone]);

  useFocusEffect(
    useCallback(() => {
      void load();
      const timer = setInterval(() => void load(), REFRESH_MS);
      return () => clearInterval(timer);
    }, [load]),
  );

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const res = await api.whatsapp.inbox[':phone'].reply.$post({ param: { phone }, json: { text } });
      if (!res.ok) {
        showToast(await apiErrorMessage(res, 'Couldn’t send.'), 'error');
        return;
      }
      setDraft('');
      await load();
    } catch {
      showToast('You’re offline. Try again when connected.', 'error');
    } finally {
      setSending(false);
    }
  };

  const markDone = async () => {
    try {
      const res = await api.whatsapp.inbox[':phone'].done.$post({ param: { phone } });
      if (!res.ok) {
        showToast(await apiErrorMessage(res, 'Couldn’t update.'), 'error');
        return;
      }
      showToast('Marked as done');
      navigation.goBack();
    } catch {
      showToast('You’re offline. Try again when connected.', 'error');
    }
  };

  const title = thread?.name ?? route.params.name ?? formatPhone(phone);
  const call = () => void Linking.openURL(`tel:${phone}`).catch(() => undefined);

  return (
    <ScreenContainer noPadding>
      <View style={styles.headerPad}>
        <ScreenHeader
          title={title}
          onBack={() => navigation.goBack()}
          right={
            <Pressable onPress={call} hitSlop={10} style={styles.callBtn} accessibilityLabel="Call the customer">
              <IconPhone size={18} color={colors.indigo} />
            </Pressable>
          }
        />
        {thread?.name ? <Text style={styles.subtitle}>+91 {formatPhone(phone)}</Text> : null}
      </View>
      {!thread ? (
        <View style={styles.center}>
          {error ? <Text style={styles.errorText}>{error}</Text> : <ActivityIndicator color={colors.water} size="large" />}
        </View>
      ) : (
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          {thread.awaitingSince ? (
            <View style={styles.waitingBar}>
              <Text style={styles.waitingText}>Waiting for a reply since {inboxTime(thread.awaitingSince)}</Text>
              <Pressable onPress={() => void markDone()} hitSlop={8} style={styles.doneBtn}>
                <Text style={styles.doneText}>Mark done</Text>
              </Pressable>
            </View>
          ) : null}
          <FlatList
            ref={listRef}
            data={thread.messages}
            keyExtractor={(m) => m.id}
            contentContainerStyle={styles.messages}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
            renderItem={({ item, index }) => {
              const prev = thread.messages[index - 1];
              const newDay = !prev || new Date(prev.at).toDateString() !== new Date(item.at).toDateString();
              return (
                <>
                  {newDay ? <Text style={styles.day}>{inboxTime(item.at)}</Text> : null}
                  <View style={[styles.bubble, item.fromCustomer ? styles.bubbleIn : styles.bubbleOut, item.status === 'failed' && styles.bubbleFailed]}>
                    {!item.fromCustomer && item.by ? <Text style={styles.by}>{item.by}</Text> : null}
                    <Text style={styles.bubbleText}>{item.text}</Text>
                    <Text style={styles.time}>
                      {bubbleTime(item.at)}
                      {item.fromCustomer ? '' : item.status === 'read' ? '  ✓✓ read' : item.status === 'delivered' ? '  ✓✓' : item.status === 'failed' ? '  not sent' : '  ✓'}
                    </Text>
                  </View>
                </>
              );
            }}
          />
          {thread.stoppedOffers ? <Text style={styles.note}>This customer turned off offers (STOP). Replies to their questions are fine.</Text> : null}
          {thread.canReply ? (
            <View style={styles.composer}>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                placeholder="Reply on WhatsApp…"
                placeholderTextColor={colors.slate}
                style={styles.input}
                multiline
                maxLength={4000}
              />
              <Pressable
                onPress={() => void send()}
                disabled={!draft.trim() || sending}
                style={[styles.sendBtn, (!draft.trim() || sending) && styles.sendOff]}
                accessibilityLabel="Send reply"
              >
                {sending ? <ActivityIndicator color={colors.white} size="small" /> : <SendIcon color={colors.white} />}
              </Pressable>
            </View>
          ) : (
            <View style={styles.closed}>
              <Text style={styles.closedTitle}>Can’t reply on WhatsApp now</Text>
              <Text style={styles.closedBody}>
                WhatsApp allows replies only within 24 hours of the customer’s last message. Call them, or wait for them to message again.
              </Text>
              <Pressable onPress={call} style={styles.callWide}>
                <IconPhone size={16} color={colors.white} />
                <Text style={styles.callWideText}>Call +91 {formatPhone(phone)}</Text>
              </Pressable>
            </View>
          )}
        </KeyboardAvoidingView>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  headerPad: { paddingHorizontal: spacing.md },
  subtitle: { ...typography.caption, color: colors.slateDeep, textAlign: 'center', marginTop: -6, marginBottom: spacing.xs },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  errorText: { ...typography.body, color: colors.slateDeep, textAlign: 'center' },
  callBtn: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.indigoPale },
  waitingBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.md,
    marginBottom: spacing.xs,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: radius.md,
    backgroundColor: '#DCFCE7',
  },
  waitingText: { ...typography.caption, flex: 1, color: '#0F7A3D', fontSize: 12.5, fontWeight: '600' },
  doneBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: '#0F7A3D' },
  doneText: { ...typography.label, color: colors.white, fontSize: 12 },
  messages: { paddingHorizontal: spacing.md, paddingBottom: spacing.md, gap: 6, backgroundColor: '#EFEAE2', flexGrow: 1 },
  day: { ...typography.caption, alignSelf: 'center', marginVertical: spacing.sm, paddingHorizontal: 10, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: '#FFFFFFCC', color: colors.slateDeep, fontSize: 11.5 },
  bubble: { maxWidth: '84%', paddingHorizontal: 12, paddingTop: 7, paddingBottom: 5, borderRadius: 14 },
  bubbleIn: { alignSelf: 'flex-start', backgroundColor: colors.white, borderTopLeftRadius: 4 },
  bubbleOut: { alignSelf: 'flex-end', backgroundColor: '#D9FDD3', borderTopRightRadius: 4 },
  bubbleFailed: { backgroundColor: '#FEE2E2' },
  by: { ...typography.caption, color: '#0F7A3D', fontWeight: '700', fontSize: 11.5, marginBottom: 2 },
  bubbleText: { ...typography.body, color: '#111B21', fontSize: 14.5, lineHeight: 20 },
  time: { ...typography.caption, alignSelf: 'flex-end', color: '#667781', fontSize: 10.5, marginTop: 2 },
  note: { ...typography.caption, color: colors.amberDeep, textAlign: 'center', paddingHorizontal: spacing.md, paddingVertical: 6 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, padding: spacing.sm, backgroundColor: colors.white, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  input: { ...typography.body, flex: 1, maxHeight: 120, minHeight: 44, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 22, backgroundColor: '#F0F2F5', color: colors.ink },
  sendBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0F7A3D' },
  sendOff: { opacity: 0.45 },
  closed: { padding: spacing.md, gap: 6, backgroundColor: colors.white, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  closedTitle: { ...typography.bodyStrong, color: colors.ink },
  closedBody: { ...typography.body, color: colors.slateDeep, fontSize: 13.5 },
  callWide: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 6, paddingVertical: 12, borderRadius: radius.pill, backgroundColor: colors.indigo },
  callWideText: { ...typography.label, color: colors.white },
});
