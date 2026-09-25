import React, { forwardRef } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Avatar } from '../Avatar';
import { IconClose, IconCloudOff, IconPlus, IconSearch } from '../Icons';
import { colors, radius, spacing, typography } from '../../theme';
import { formatRelativeDate } from '../../utils/format';
import type { DirectoryEntry } from '../../offline/directory';
import type { QueryKind, SearchHit } from '../../utils/customerSearch';
import { MIN_QUERY_LENGTH } from '../../utils/customerSearch';
import { Highlight, PlateBadge } from './Highlight';

interface Props {
  query: string;
  onChangeQuery: (q: string) => void;
  hits: SearchHit[];
  recents: DirectoryEntry[];
  queryKind: QueryKind;
  vehicleTypeName: (id: string) => string;
  onPick: (entry: DirectoryEntry) => void;
  onNewCustomer: () => void;
  /** An exact server lookup is running because nothing on the phone matched. */
  checkingServer: boolean;
  status: { online: boolean; count: number; lastSyncAt: number | null; syncing: boolean };
}

function visitLine(entry: DirectoryEntry, typeName: string): string {
  const parts = [typeName];
  if (entry.visitCount > 0)
    parts.push(`${entry.visitCount} visit${entry.visitCount === 1 ? '' : 's'}`);
  if (entry.lastVisit) parts.push(formatRelativeDate(entry.lastVisit).toLowerCase());
  return parts.filter(Boolean).join(' · ');
}

function newCustomerCopy(query: string, kind: QueryKind): { title: string; hint: string } {
  const q = query.trim();
  switch (kind) {
    case 'plate':
      return {
        title: 'New customer',
        hint: `Start with ${q.toUpperCase().replace(/\s+/g, '')} as a new vehicle`,
      };
    case 'phone':
      return { title: 'New customer', hint: `Start with +91 ${q.replace(/\D/g, '').slice(-10)}` };
    case 'name':
      return {
        title: `Add “${q.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase())}”`,
        hint: 'As a new customer',
      };
    default:
      return { title: 'New customer', hint: 'First time here? Add their details' };
  }
}

function syncLine(status: Props['status']): string {
  if (!status.online) return `Offline · searching ${status.count} saved vehicles`;
  if (status.syncing && status.count === 0) return 'Downloading customers…';
  const count = `${status.count.toLocaleString('en-IN')} saved vehicle${status.count === 1 ? '' : 's'}`;
  if (!status.lastSyncAt) return count;
  const mins = Math.floor((Date.now() - status.lastSyncAt) / 60_000);
  return `${count} · updated ${mins < 1 ? 'just now' : `${mins} min ago`}`;
}

/**
 * Step 1 of New Wash: one box that finds a customer by plate, phone or name, with the
 * matching vehicles listed underneath and "New customer" always one tap away.
 */
export const CustomerSearch = forwardRef<TextInput, Props>(function CustomerSearch(
  {
    query,
    onChangeQuery,
    hits,
    recents,
    queryKind,
    vehicleTypeName,
    onPick,
    onNewCustomer,
    checkingServer,
    status,
  },
  ref,
) {
  const searching = query.trim().length >= MIN_QUERY_LENGTH;
  const rows = searching
    ? hits.map((h) => ({ entry: h.entry, hit: h }))
    : recents.map((e) => ({ entry: e, hit: null }));
  const fresh = newCustomerCopy(query, queryKind);

  return (
    <View>
      <View style={styles.fieldWrap}>
        <View style={styles.field}>
          <IconSearch size={19} color={colors.waterDeep} />
          <TextInput
            ref={ref}
            value={query}
            onChangeText={onChangeQuery}
            placeholder="Plate, phone or name"
            placeholderTextColor="#94A3B8"
            style={styles.input}
            autoCapitalize="characters"
            autoCorrect={false}
            returnKeyType="search"
            maxLength={40}
            disableFullscreenUI
            accessibilityLabel="Search customers by plate, phone or name"
          />
          {checkingServer ? (
            <ActivityIndicator size="small" color={colors.water} />
          ) : query ? (
            <Pressable
              onPress={() => onChangeQuery('')}
              hitSlop={10}
              accessibilityLabel="Clear search"
            >
              <View style={styles.clearBtn}>
                <IconClose size={10} color={colors.white} />
              </View>
            </Pressable>
          ) : null}
        </View>
        <View style={styles.statusRow}>
          {!status.online ? <IconCloudOff size={12} color={colors.slate} /> : null}
          <Text style={styles.statusText}>{syncLine(status)}</Text>
        </View>
      </View>

      {rows.length > 0 ? (
        <Text style={styles.sectionLabel}>{searching ? 'Matches' : 'Recent customers'}</Text>
      ) : searching && !checkingServer ? (
        <Text style={styles.empty}>No saved customer matches “{query.trim()}”</Text>
      ) : null}

      <View style={styles.list}>
        {rows.map(({ entry, hit }) => {
          const typeName = vehicleTypeName(entry.vehicleTypeId);
          const name = entry.customerName || 'Unnamed customer';
          return (
            <Pressable
              key={entry.registrationNumber}
              onPress={() => onPick(entry)}
              android_ripple={{ color: colors.waterPale }}
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              accessibilityRole="button"
              accessibilityLabel={`${name}, ${entry.registrationNumber}, ${typeName}`}
            >
              <Avatar name={name} id={entry.customerId} size={42} />
              <View style={styles.rowBody}>
                <Highlight
                  text={name}
                  needle={hit?.field === 'name' ? hit.needle : null}
                  style={styles.rowName}
                />
                {hit?.field === 'phone' ? (
                  <Highlight
                    text={entry.customerPhone}
                    needle={hit.needle}
                    style={styles.rowMeta}
                  />
                ) : (
                  <Text style={styles.rowMeta} numberOfLines={1}>
                    {visitLine(entry, typeName)}
                  </Text>
                )}
              </View>
              <PlateBadge
                plate={entry.registrationNumber}
                needle={hit?.field === 'plate' ? hit.needle : null}
              />
            </Pressable>
          );
        })}

        <Pressable
          onPress={onNewCustomer}
          android_ripple={{ color: colors.waterPale }}
          style={({ pressed }) => [styles.row, styles.newRow, pressed && styles.rowPressed]}
          accessibilityRole="button"
        >
          <View style={styles.newIcon}>
            <IconPlus size={18} color={colors.white} />
          </View>
          <View style={styles.rowBody}>
            <Text style={styles.newTitle} numberOfLines={1}>
              {fresh.title}
            </Text>
            <Text style={styles.rowMeta} numberOfLines={1}>
              {fresh.hint}
            </Text>
          </View>
        </Pressable>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  fieldWrap: { paddingHorizontal: spacing.md, gap: 6 },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.waterLight,
    paddingHorizontal: spacing.md,
    minHeight: 56,
    shadowColor: colors.water,
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  input: {
    flex: 1,
    fontSize: 18,
    fontWeight: '600',
    color: colors.waterInk,
    letterSpacing: 0.4,
    paddingVertical: 12,
  },
  clearBtn: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.slate,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 4 },
  statusText: { ...typography.caption, color: colors.slate, letterSpacing: 0, fontSize: 11 },
  sectionLabel: {
    ...typography.caption,
    color: colors.slateDeep,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    fontSize: 11,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: 6,
  },
  empty: {
    ...typography.body,
    color: colors.slateDeep,
    fontSize: 14,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  list: {
    backgroundColor: colors.white,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    marginTop: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 4,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    minHeight: 64,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowPressed: { backgroundColor: colors.surface },
  rowBody: { flex: 1, minWidth: 0 },
  rowName: { ...typography.bodyStrong, color: colors.waterInk, fontSize: 16 },
  rowMeta: { ...typography.caption, color: colors.slateDeep, letterSpacing: 0, marginTop: 1 },
  newRow: { borderBottomWidth: 0 },
  newIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.water,
    alignItems: 'center',
    justifyContent: 'center',
  },
  newTitle: { ...typography.bodyStrong, color: colors.water, fontSize: 16 },
});
