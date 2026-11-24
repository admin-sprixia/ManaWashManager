import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  StatusBar,
  View,
} from 'react-native';
import ReactNativeBlobUtil from 'react-native-blob-util';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import Svg, { Path } from 'react-native-svg';
import { IconClose, IconPhone, ScreenContainer, ScreenHeader, colors, radius, showToast, spacing, typography } from '@mana/ui';
import { API_BASE_URL, api, apiErrorMessage, imageHeaders } from '../api/client';
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
  /** A photo, video, voice note or document the customer sent. */
  media: Media | null;
}
type Media =
  | { kind: string; type: string | null; saved: true; path: string }
  | { kind: string; type: string | null; saved: false; path: null };
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
  const [headers, setHeaders] = useState<Record<string, string> | undefined>();
  const [viewing, setViewing] = useState<string | null>(null);

  useEffect(() => {
    void imageHeaders().then(setHeaders);
  }, []);

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
                    {item.media ? (
                      <MediaBlock media={item.media} text={item.text} headers={headers} onOpenPhoto={setViewing} />
                    ) : (
                      <Text style={styles.bubbleText}>{item.text}</Text>
                    )}
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
      <PhotoViewer path={viewing} headers={headers} onClose={() => setViewing(null)} />
    </ScreenContainer>
  );
}

const MEDIA_NAME: Record<string, string> = {
  image: 'Photo',
  sticker: 'Sticker',
  video: 'Video',
  audio: 'Voice note',
  document: 'Document',
};
const MEDIA_ICON: Record<string, string> = { video: '▶️', audio: '🎤', document: '📄' };

/** The caption the customer typed under the file ("📷 Photo: this scratch?" → "this scratch?"). */
function captionOf(text: string): string | null {
  const i = text.indexOf(': ');
  return i >= 0 ? text.slice(i + 2).trim() || null : null;
}

/** File extension for a downloaded file, so the phone picks the right app to open it. */
function extensionFor(type: string | null, kind: string): string {
  const sub = (type ?? '').split('/')[1]?.split(';')[0]?.trim();
  if (sub === 'mpeg' && kind === 'audio') return 'mp3';
  if (sub === 'ogg' || sub === 'opus') return 'ogg';
  if (sub === 'quicktime') return 'mov';
  if (sub === 'vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx';
  return sub && /^[a-z0-9]{2,5}$/.test(sub) ? sub : kind === 'video' ? 'mp4' : 'bin';
}

/**
 * A file in the chat. Photos show in the bubble and open full screen; a video, voice note or
 * document is fetched to the phone and opened in its own app (video player, PDF viewer).
 */
function MediaBlock({
  media,
  text,
  headers,
  onOpenPhoto,
}: {
  media: Media;
  text: string;
  headers?: Record<string, string>;
  onOpenPhoto: (path: string) => void;
}) {
  const [opening, setOpening] = useState(false);
  const caption = captionOf(text);
  const name = MEDIA_NAME[media.kind] ?? 'File';
  if (!media.saved) {
    return (
      <>
        <Text style={styles.bubbleText}>{text}</Text>
        <Text style={styles.mediaMissing}>Not saved in the app. Ask the customer to send it again.</Text>
      </>
    );
  }
  const path = media.path;
  if (media.kind === 'image' || media.kind === 'sticker') {
    return (
      <>
        <Pressable onPress={() => onOpenPhoto(path)} accessibilityLabel={`Open ${name.toLowerCase()}`}>
          {headers ? (
            <Image source={{ uri: `${API_BASE_URL}${path}`, headers }} style={media.kind === 'sticker' ? styles.sticker : styles.photo} resizeMode="cover" />
          ) : (
            <View style={styles.photo} />
          )}
        </Pressable>
        {caption ? <Text style={styles.bubbleText}>{caption}</Text> : null}
      </>
    );
  }
  const open = async () => {
    if (opening) return;
    setOpening(true);
    try {
      const target = `${ReactNativeBlobUtil.fs.dirs.CacheDir}/wa-${path.split('/').pop()!.replace(/[^A-Za-z0-9]/g, '').slice(-40)}.${extensionFor(media.type, media.kind)}`;
      if (!(await ReactNativeBlobUtil.fs.exists(target))) {
        const res = await ReactNativeBlobUtil.config({ path: target }).fetch('GET', `${API_BASE_URL}${path}`, headers ?? (await imageHeaders()));
        if (res.info().status !== 200) {
          await ReactNativeBlobUtil.fs.unlink(target).catch(() => undefined);
          showToast(`Couldn’t open the ${name.toLowerCase()}.`, 'error');
          return;
        }
      }
      if (Platform.OS === 'android') {
        await ReactNativeBlobUtil.android.actionViewIntent(target, media.type ?? '*/*', `Open ${name.toLowerCase()} with`);
      } else {
        await ReactNativeBlobUtil.ios.openDocument(target);
      }
    } catch {
      showToast(`Couldn’t open the ${name.toLowerCase()}. Check the connection.`, 'error');
    } finally {
      setOpening(false);
    }
  };
  return (
    <>
      <Pressable onPress={() => void open()} style={styles.fileTile} accessibilityLabel={`Open ${name.toLowerCase()}`}>
        {opening ? <ActivityIndicator color={colors.indigo} size="small" /> : <Text style={styles.fileIcon}>{MEDIA_ICON[media.kind] ?? '📎'}</Text>}
        <View style={styles.flex}>
          <Text style={styles.fileName}>{name}</Text>
          <Text style={styles.fileHint}>Tap to open</Text>
        </View>
      </Pressable>
      {caption ? <Text style={styles.bubbleText}>{caption}</Text> : null}
    </>
  );
}

/** A customer's photo, full screen. */
function PhotoViewer({ path, headers, onClose }: { path: string | null; headers?: Record<string, string>; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={path != null} animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.viewer}>
        {path ? <Image source={{ uri: `${API_BASE_URL}${path}`, headers }} style={styles.viewerImage} resizeMode="contain" /> : null}
        <Pressable
          onPress={onClose}
          hitSlop={10}
          style={[styles.viewerClose, { top: Math.max(insets.top, StatusBar.currentHeight ?? 0) + spacing.sm }]}
          accessibilityLabel="Close"
        >
          <IconClose size={18} color={colors.white} />
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  photo: { width: 220, height: 220, borderRadius: 10, backgroundColor: '#E5E7EB', marginBottom: 4 },
  sticker: { width: 120, height: 120, marginBottom: 4 },
  mediaMissing: { ...typography.caption, color: colors.slate, fontSize: 11.5, marginTop: 2 },
  fileTile: { flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 190, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, backgroundColor: '#F0F2F5', marginBottom: 4 },
  fileIcon: { fontSize: 22 },
  fileName: { ...typography.bodyStrong, color: '#111B21', fontSize: 14 },
  fileHint: { ...typography.caption, color: '#667781', fontSize: 11.5 },
  viewer: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  viewerImage: { width: '100%', height: '100%' },
  viewerClose: { position: 'absolute', right: spacing.md, width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF33' },
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
