import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatInr, UNIT_BLOCK_MAX, unitLabel } from '@mana/domain';
import { BottomSheet, Button, IconClose, IconGrid, TextField, colors, radius, showAlert, spacing, typography } from '@mana/ui';
import { api, type ApiResponse } from '../../api/client';
import { SheetHead, SheetLabel, SheetNotice } from '../../components/SheetBits';
import { TEAL, TEAL_MIST, TEAL_PALE } from './panel/parts';
import { flatTotal, isUnpaid, memberVehicles, membersByUnit } from './review/memberFlats';
import type { PlaceDetail, PlaceMember } from './shared';

export type Unit = PlaceDetail['units'][number];

/** Roughly how many numbers "101-110, 201-205, 301" makes, for the preview under the field. */
function countTyped(text: string): number {
  let n = 0;
  for (const part of text.split(/[,\s]+/).filter(Boolean)) {
    const range = /^(\d+)-(\d+)$/.exec(part);
    if (range) {
      const a = Number(range[1]);
      const b = Number(range[2]);
      n += b >= a ? Math.min(500, b - a + 1) : 0;
    } else n += 1;
  }
  return n;
}

/** "48 flats in 3 blocks". */
export function unitsSummary(units: readonly Unit[], noun: string): string {
  const lower = noun.toLowerCase();
  if (!units.length) return `No ${lower}s yet`;
  const blocks = new Set(units.map((u) => u.block).filter(Boolean)).size;
  return `${units.length} ${units.length === 1 ? lower : `${lower}s`}${blocks ? ` in ${blocks} block${blocks === 1 ? '' : 's'}` : ''}`;
}

/**
 * The flats (or houses) people pick when they join: shown by block, typed in as ranges
 * ("101-110, 201-210"), and taken off with a tap (members already living there stay).
 */
/** A taken flat: who lives there, their vehicles and plans, and what the flat pays. */
function TakenRow({ number, member, onLongPress }: { number: string; member: PlaceMember; onLongPress?: () => void }) {
  const vehicles = memberVehicles(member);
  const plans = [...new Set(vehicles.map((v) => v.order?.title).filter((t): t is string => !!t))];
  const total = flatTotal(member);
  const unpaid = vehicles.some((v) => isUnpaid(v.order));
  return (
    <Pressable onLongPress={onLongPress} style={({ pressed }) => [styles.taken, pressed && styles.pressed]} accessibilityRole="text">
      <View style={[styles.takenNo, unpaid && styles.takenNoUnpaid]}>
        <Text style={[styles.takenNoText, unpaid && styles.takenNoTextUnpaid]} numberOfLines={1} adjustsFontSizeToFit>
          {number}
        </Text>
      </View>
      <View style={styles.takenCopy}>
        <Text style={styles.takenName} numberOfLines={1}>
          {member.customer.name?.trim() || `+91 ${member.customer.phone}`}
        </Text>
        <Text style={styles.takenMeta} numberOfLines={2}>
          {vehicles.map((v) => v.label).join(', ') || 'No vehicles'}
          {plans.length ? `  ·  ${plans.join(', ')}` : ''}
        </Text>
      </View>
      <View style={styles.takenRight}>
        {total ? <Text style={[styles.takenPrice, unpaid && styles.takenPriceUnpaid]}>{formatInr(total)}</Text> : null}
        {unpaid ? <Text style={styles.takenUnpaid}>Not paid</Text> : null}
      </View>
    </Pressable>
  );
}

export function UnitsEditor({
  placeId,
  units,
  noun,
  run,
  resetKey,
  members,
}: {
  placeId: string;
  units: readonly Unit[];
  noun: string;
  run: (call: () => Promise<ApiResponse>, done?: string) => Promise<string | null>;
  /** Changing it clears the typed numbers (the sheet passes whether it's open). */
  resetKey?: unknown;
  /** Who lives where: taken flats show the resident, vehicles, plan and what they pay. */
  members?: readonly PlaceMember[];
}) {
  const [block, setBlock] = useState('');
  const [numbers, setNumbers] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setNumbers('');
    setError(null);
    setBusy(false);
  }, [resetKey]);

  const byBlock = useMemo(() => {
    const groups = new Map<string, Unit[]>();
    for (const u of units) groups.set(u.block ?? '', [...(groups.get(u.block ?? '') ?? []), u]);
    return [...groups.entries()];
  }, [units]);
  const blocks = byBlock.filter(([name]) => name).length;
  const typed = numbers.trim() ? countTyped(numbers) : 0;
  const lower = noun.toLowerCase();
  const residents = useMemo(() => membersByUnit(members ?? []), [members]);
  const listed = useMemo(() => new Set(units.map((u) => unitLabel(u.block, u.number))), [units]);
  /** Members who typed a flat that isn't on the list (houses, or before the list existed). */
  const offList = (members ?? []).filter((m) => !listed.has(m.unit));
  const takenCount = (members ?? []).length;

  const add = async () => {
    if (!numbers.trim()) return setError('Type the numbers, e.g. 101-110, 201-210.');
    setBusy(true);
    setError(null);
    const message = await run(
      () => api.places[':id'].units.$post({ param: { id: placeId }, json: { block: block.trim() || null, numbers: numbers.trim() } }),
      `${noun}s added`,
    );
    setBusy(false);
    if (message) setError(message);
    else setNumbers('');
  };

  const archive = (u: Unit) =>
    showAlert(`Remove ${u.block ? `${u.block} · ` : ''}${u.number}?`, 'It won’t be offered to new members. Anyone living there stays.', [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () =>
          void run(() => api.places[':id'].units[':unitId'].$delete({ param: { id: placeId, unitId: u.id } }), 'Removed').then(
            (message) => message && setError(message),
          ),
      },
    ]);

  return (
    <View style={styles.body}>
      <SheetHead
        tone="teal"
        icon={<IconGrid size={20} color={TEAL} />}
        title={unitsSummary(units, noun)}
        caption={
          units.length
            ? `Members pick their ${lower} from this list when they join. Tap one to take it off.`
            : `Add the ${lower} numbers so members can pick theirs when they join.`
        }
      />

      {members && takenCount ? (
        <View style={styles.occupancy}>
          <View style={styles.occItem}>
            <Text style={[styles.occValue, { color: TEAL }]}>{takenCount}</Text>
            <Text style={styles.occLabel}>taken</Text>
          </View>
          <View style={styles.occItem}>
            <Text style={styles.occValue}>{Math.max(0, units.length - (takenCount - offList.length))}</Text>
            <Text style={styles.occLabel}>free</Text>
          </View>
          <View style={styles.occItem}>
            <Text style={[styles.occValue, { color: '#15803D' }]}>{formatInr((members ?? []).reduce((n, m) => n + flatTotal(m), 0))}</Text>
            <Text style={styles.occLabel}>all flats pay</Text>
          </View>
        </View>
      ) : null}

      {byBlock.map(([name, list]) => {
        const taken = list.filter((u) => residents.has(unitLabel(u.block, u.number)));
        const free = list.filter((u) => !residents.has(unitLabel(u.block, u.number)));
        return (
          <View key={name || 'none'} style={styles.group}>
            <View style={styles.groupHead}>
              <Text style={styles.groupTitle}>{name ? `Block ${name}` : blocks ? 'No block' : `All ${lower}s`}</Text>
              <Text style={styles.groupCount}>
                {members ? `${taken.length} of ${list.length} taken` : list.length}
              </Text>
            </View>
            {taken.flatMap((u) =>
              residents.get(unitLabel(u.block, u.number))!.map((m) => <TakenRow key={`${u.id}-${m.id}`} number={u.number} member={m} onLongPress={() => archive(u)} />),
            )}
            {free.length ? (
              <>
                {taken.length ? <Text style={styles.freeLabel}>Free</Text> : null}
                <View style={styles.grid}>
                  {free.map((u) => (
                    <Pressable
                      key={u.id}
                      onPress={() => archive(u)}
                      style={({ pressed }) => [styles.unit, pressed && styles.pressed]}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${u.number}`}
                    >
                      <Text style={styles.unitText}>{u.number}</Text>
                      <IconClose size={10} color={colors.slate} />
                    </Pressable>
                  ))}
                </View>
              </>
            ) : null}
          </View>
        );
      })}

      {offList.length ? (
        <View style={styles.group}>
          <View style={styles.groupHead}>
            <Text style={styles.groupTitle}>Typed by residents</Text>
            <Text style={styles.groupCount}>{offList.length}</Text>
          </View>
          <Text style={styles.freeLabel}>Not on the list above. Add these numbers so the next residents can pick them.</Text>
          {offList.map((m) => (
            <TakenRow key={m.id} number={m.unit} member={m} />
          ))}
        </View>
      ) : null}

      <View style={styles.addCard}>
        <SheetLabel>{units.length ? `Add more ${lower}s` : `Add ${lower}s`}</SheetLabel>
        <TextField label="Block or tower" optional value={block} onChangeText={setBlock} maxLength={UNIT_BLOCK_MAX} placeholder="A" autoCapitalize="characters" />
        <TextField
          label={`${noun} numbers`}
          value={numbers}
          onChangeText={(t) => {
            setNumbers(t);
            if (error) setError(null);
          }}
          placeholder="101-110, 201-210"
          hint={typed ? `That’s about ${typed} ${typed === 1 ? lower : `${lower}s`}. Ones already there are skipped.` : 'Ranges and lists both work. Ones already there are skipped.'}
          autoCapitalize="characters"
        />
        {error ? <SheetNotice tone="danger">{error}</SheetNotice> : null}
        <Button label={typed ? `Add ${typed} ${typed === 1 ? lower : `${lower}s`}` : `Add ${lower}s`} loading={busy} onPress={() => void add()} />
      </View>
    </View>
  );
}

/** The flats list as a sheet, from the community page. */
export function UnitsSheet({
  visible,
  placeId,
  units,
  noun,
  onClose,
  run,
  members,
}: {
  visible: boolean;
  placeId: string;
  units: Unit[];
  noun: string;
  onClose: () => void;
  run: (call: () => Promise<ApiResponse>, done?: string) => Promise<string | null>;
  members?: readonly PlaceMember[];
}) {
  return (
    <BottomSheet visible={visible} onClose={onClose} title={`${noun}s`}>
      <UnitsEditor placeId={placeId} units={units} noun={noun} run={run} resetKey={visible} members={members} />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.md },
  group: {
    gap: spacing.sm,
    padding: spacing.sm + 4,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  groupHead: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  groupTitle: { ...typography.bodyStrong, fontSize: 14.5, fontWeight: '800', color: colors.waterInk },
  groupCount: { ...typography.label, fontSize: 12.5, color: colors.slate },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  unit: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minWidth: 56,
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: TEAL_MIST,
    borderWidth: 1,
    borderColor: TEAL_PALE,
  },
  unitText: { fontSize: 13.5, fontWeight: '800', color: TEAL, letterSpacing: 0.2 },
  pressed: { opacity: 0.6 },
  addCard: { gap: spacing.md, padding: spacing.sm + 4, borderRadius: radius.lg, backgroundColor: colors.surface },
  occupancy: { flexDirection: 'row', gap: spacing.sm },
  occItem: { flex: 1, alignItems: 'center', paddingVertical: spacing.sm + 2, borderRadius: 14, backgroundColor: colors.surface, gap: 1 },
  occValue: { ...typography.heading, fontSize: 19, color: colors.waterInk, letterSpacing: -0.3 },
  occLabel: { ...typography.caption, fontSize: 11.5, color: colors.slateDeep, letterSpacing: 0 },
  freeLabel: { ...typography.caption, fontSize: 12, fontWeight: '700', color: colors.slate, letterSpacing: 0.1 },
  taken: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
    padding: spacing.sm + 2,
    borderRadius: 14,
    backgroundColor: TEAL_MIST,
    borderWidth: 1,
    borderColor: TEAL_PALE,
  },
  takenNo: { minWidth: 48, height: 40, paddingHorizontal: 6, borderRadius: 12, backgroundColor: TEAL, alignItems: 'center', justifyContent: 'center' },
  takenNoUnpaid: { backgroundColor: '#FEE2E2' },
  takenNoText: { fontSize: 14, fontWeight: '800', color: colors.white, letterSpacing: 0.2 },
  takenNoTextUnpaid: { color: colors.danger },
  takenCopy: { flex: 1, gap: 1, minWidth: 0 },
  takenName: { ...typography.bodyStrong, fontSize: 14.5, fontWeight: '800', color: colors.waterInk },
  takenMeta: { ...typography.caption, fontSize: 12, color: colors.slateDeep, letterSpacing: 0, lineHeight: 16 },
  takenRight: { alignItems: 'flex-end', gap: 1 },
  takenPrice: { ...typography.heading, fontSize: 15.5, color: TEAL },
  takenPriceUnpaid: { color: colors.danger },
  takenUnpaid: { ...typography.caption, fontSize: 11, fontWeight: '800', color: colors.danger, letterSpacing: 0 },
});
