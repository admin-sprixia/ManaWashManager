import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { ImagePickerResponse } from 'react-native-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MAX_PHOTO_BYTES, MAX_PHOTOS_PER_KIND, type PhotoKind } from '@mana/domain';
import {
  colors,
  radius,
  spacing,
  typography,
  IconCamera,
  IconClose,
  IconCloudOff,
  IconTrash,
  showToast,
  showAlert,
} from '@mana/ui';
import { api, apiErrorMessage } from '../api/client';
import { getSessionToken } from '../api/session';
import { NetworkError } from '../api/network';
import { useSync } from '../offline/SyncProvider';
import { keepLocalCopy } from '../offline/photoFiles';
import { newId } from '../utils/id';
import { formatDateTime } from '../utils/format';
import { pickPhotos } from '../utils/photoPicker';

export interface JobPhoto {
  id: string;
  kind: PhotoKind;
  createdAt: string;
  takenBy?: { id: string; name: string } | null;
}

interface Tile {
  id: string;
  kind: PhotoKind;
  uri: string;
  /** Still on this phone, waiting to upload. */
  local: boolean;
  failed?: boolean;
  createdAt: string;
  takenBy?: string;
}

interface JobPhotosProps {
  jobId: string;
  photos: JobPhoto[];
  canAdd: boolean;
  canDelete: boolean;
  baseUrl: string;
  onChanged: () => void;
}

const KINDS: { kind: PhotoKind; label: string }[] = [
  { kind: 'before', label: 'Before' },
  { kind: 'after', label: 'After' },
];

/** Optional before/after photos. Taken photos queue on the phone and upload when there's signal. */
export function JobPhotos({ jobId, photos, canAdd, canDelete, baseUrl, onChanged }: JobPhotosProps) {
  const { items, submit } = useSync();
  const [token, setToken] = useState<string | null>(null);
  const [adding, setAdding] = useState<PhotoKind | null>(null);
  const [viewing, setViewing] = useState<Tile | null>(null);

  useEffect(() => {
    void getSessionToken().then(setToken);
  }, []);

  const queued: Tile[] = items.flatMap((i) =>
    i.op.kind === 'photo.upload' && i.op.payload.jobId === jobId
      ? [
          {
            id: i.op.payload.id,
            kind: i.op.payload.kind,
            uri: i.op.payload.uri,
            local: true,
            failed: i.state === 'failed',
            createdAt: i.op.payload.occurredAt,
            takenBy: i.userName,
          },
        ]
      : [],
  );
  const tiles: Tile[] = [
    ...photos
      .filter((p) => !queued.some((q) => q.id === p.id))
      .map((p) => ({
        id: p.id,
        kind: p.kind,
        uri: `${baseUrl}/photos/${p.id}`,
        local: false,
        createdAt: p.createdAt,
        takenBy: p.takenBy?.name,
      })),
    ...queued,
  ];

  const headers = token ? { Authorization: `Bearer ${token}` } : undefined;

  const handlePicked = async (kind: PhotoKind, res: ImagePickerResponse, room: number) => {
    if (res.didCancel) return;
    const assets = (res.assets ?? []).filter((a) => a.uri).slice(0, room);
    if (res.errorCode || assets.length === 0) {
      showToast(res.errorMessage ?? 'Couldn’t get that photo.', 'error');
      return;
    }
    setAdding(kind);
    let saved = 0;
    let queued = 0;
    let tooBig = 0;
    let problem: string | null = null;
    try {
      // One at a time, so the server's per-job limit is checked against each upload in order.
      for (const asset of assets) {
        if (asset.fileSize && asset.fileSize > MAX_PHOTO_BYTES) {
          tooBig += 1;
          continue;
        }
        const contentType = asset.type === 'image/png' ? 'image/png' : 'image/jpeg';
        const id = newId();
        const uri = await keepLocalCopy(asset.uri!, id, contentType === 'image/png' ? 'png' : 'jpg');
        const result = await submit({
          kind: 'photo.upload',
          payload: { id, jobId, kind, uri, contentType, occurredAt: new Date().toISOString() },
        });
        if (result.status === 'rejected') {
          problem = result.message;
          break;
        }
        if (result.status === 'queued') queued += 1;
        else saved += 1;
      }
    } catch {
      problem = 'Couldn’t save that photo.';
    } finally {
      setAdding(null);
    }
    if (saved > 0) onChanged();
    if (problem) showToast(problem, 'error');
    else if (tooBig > 0) {
      showToast(
        `${tooBig === 1 ? 'A photo was' : `${tooBig} photos were`} too large even after shrinking and skipped.`,
        'error',
      );
    } else if (queued > 0) {
      showToast(
        `${queued === 1 ? 'Photo' : `${queued} photos`} saved on this phone — uploads when there’s signal`,
        'offline',
      );
    }
  };

  const add = async (kind: PhotoKind, room: number) => {
    const picked = await pickPhotos(`${kind === 'before' ? 'Before' : 'After'} photo`, `You can add ${room} more.`, room);
    if (picked) await handlePicked(kind, picked, room);
  };

  const deletePhoto = async (tile: Tile) => {
    try {
      const res = await api.photos[':id'].$delete({ param: { id: tile.id } });
      if (!res.ok) return showToast(await apiErrorMessage(res, 'Couldn’t delete the photo.'), 'error');
      setViewing(null);
      showToast('Photo deleted');
      onChanged();
    } catch (e) {
      showToast(e instanceof NetworkError ? 'Deleting needs a connection.' : 'Couldn’t delete the photo.', 'error');
    }
  };

  const remove = (tile: Tile) => {
    showAlert(
      'Delete this photo?',
      'It’s removed for everyone. This can’t be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => void deletePhoto(tile) },
      ],
      { icon: <IconTrash size={26} color={colors.danger} /> },
    );
  };

  return (
    <View style={styles.wrap}>
      {KINDS.map(({ kind, label }) => {
        const mine = tiles.filter((t) => t.kind === kind);
        const left = MAX_PHOTOS_PER_KIND - mine.length;
        const room = canAdd && left > 0;
        return (
          <View key={kind} style={styles.kindRow}>
            <Text style={styles.kindLabel}>
              {label}
              <Text style={styles.kindCount}>{`  ${mine.length}/${MAX_PHOTOS_PER_KIND}`}</Text>
            </Text>
            <View style={styles.tiles}>
              {mine.map((t) => (
                <Pressable
                  key={t.id}
                  onPress={() => setViewing(t)}
                  style={styles.tile}
                  accessibilityRole="imagebutton"
                  accessibilityLabel={`${label} photo`}
                >
                  <Image source={t.local ? { uri: t.uri } : { uri: t.uri, headers }} style={styles.tileImage} />
                  {t.local ? (
                    <View style={[styles.tileBadge, t.failed && styles.tileBadgeFailed]}>
                      <IconCloudOff size={11} color={t.failed ? colors.danger : colors.amberDeep} />
                    </View>
                  ) : null}
                </Pressable>
              ))}
              {room ? (
                <Pressable
                  onPress={() => void add(kind, left)}
                  disabled={adding != null}
                  style={({ pressed }) => [styles.tile, styles.addTile, pressed && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityLabel={`Add ${label.toLowerCase()} photo`}
                >
                  {adding === kind ? (
                    <ActivityIndicator color={colors.water} />
                  ) : (
                    <IconCamera size={22} color={colors.waterDeep} />
                  )}
                </Pressable>
              ) : null}
              {mine.length === 0 && !room ? <Text style={styles.none}>None</Text> : null}
            </View>
          </View>
        );
      })}

      <PhotoViewer
        tile={viewing}
        headers={headers}
        canDelete={canDelete && viewing != null && !viewing.local}
        onDelete={remove}
        onClose={() => setViewing(null)}
      />
    </View>
  );
}

function PhotoViewer({
  tile,
  headers,
  canDelete,
  onDelete,
  onClose,
}: {
  tile: Tile | null;
  headers?: Record<string, string>;
  canDelete: boolean;
  onDelete: (t: Tile) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={tile != null} animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.viewer}>
        {tile ? (
          <>
            <Image
              source={tile.local ? { uri: tile.uri } : { uri: tile.uri, headers }}
              style={styles.viewerImage}
              resizeMode="contain"
            />
            <View
              style={[
                styles.viewerTop,
                { paddingTop: Math.max(insets.top, StatusBar.currentHeight ?? 0) + spacing.sm },
              ]}
            >
              <View style={styles.flex}>
                <Text style={styles.viewerTitle}>{tile.kind === 'before' ? 'Before' : 'After'}</Text>
                <Text style={styles.viewerMeta}>
                  {[tile.takenBy, formatDateTime(tile.createdAt), tile.local ? 'not uploaded yet' : null]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              </View>
              {canDelete ? (
                <Pressable onPress={() => onDelete(tile)} hitSlop={10} style={styles.viewerBtn} accessibilityLabel="Delete photo">
                  <IconTrash size={18} color={colors.white} />
                </Pressable>
              ) : null}
              <Pressable onPress={onClose} hitSlop={10} style={styles.viewerBtn} accessibilityLabel="Close">
                <IconClose size={18} color={colors.white} />
              </Pressable>
            </View>
          </>
        ) : null}
      </View>
    </Modal>
  );
}

const TILE = 68;

const styles = StyleSheet.create({
  flex: { flex: 1 },
  wrap: {
    backgroundColor: colors.white,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  kindRow: { paddingVertical: spacing.sm, gap: spacing.sm },
  kindLabel: { ...typography.bodyStrong, color: colors.waterInk, fontSize: 15 },
  kindCount: { ...typography.caption, color: colors.slate, letterSpacing: 0 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center' },
  tile: {
    width: TILE,
    height: TILE,
    borderRadius: radius.sm,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  tileImage: { width: '100%', height: '100%' },
  tileBadge: {
    position: 'absolute',
    right: 4,
    bottom: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#FFFBEB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileBadgeFailed: { backgroundColor: '#FEF2F2' },
  addTile: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.7 },
  none: { ...typography.caption, color: colors.slate, letterSpacing: 0 },
  viewer: { flex: 1, backgroundColor: '#000' },
  viewerImage: { flex: 1 },
  viewerTop: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  viewerTitle: { ...typography.bodyStrong, color: colors.white },
  viewerMeta: { ...typography.caption, color: 'rgba(255,255,255,0.75)', letterSpacing: 0 },
  viewerBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
