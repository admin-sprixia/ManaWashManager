import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { handoverDifference, MIN_REASON_LENGTH } from '@mana/domain';
import {
  BottomSheet,
  Button,
  IconAlert,
  IconCheck,
  IconHome,
  colors,
  radius,
  shadow,
  showToast,
  spacing,
  typography,
} from '@mana/ui';
import { Pill } from '../EdgeList';
import { ReasonSheet } from '../ReasonSheet';
import { MoneyInput } from './MoneyInput';
import { api, apiErrorMessage } from '../../api/client';
import { NetworkError } from '../../api/network';
import { formatDateTime, formatRupees, parseRupees } from '../../utils/format';

export interface DoorstepPerson {
  userId: string;
  name: string;
  collectedToday: number;
  jobsToday: number;
  /** Paid from their doorstep cash on this day (expenses). */
  spentToday: number;
  handedInToday: number;
  /** Held right now, from any day. */
  held: number;
}

export interface DoorstepHandover {
  id: string;
  collectorId: string;
  collector: string;
  receivedBy: string | null;
  due: number;
  received: number;
  difference: number;
  note: string | null;
  at: string;
  voided: { by: string | null; at: string; reason: string | null } | null;
}

export interface DoorstepDay {
  collected: number;
  jobs: number;
  /** Expenses paid from doorstep cash on this day. */
  spent: number;
  handedIn: number;
  held: number;
  people: DoorstepPerson[];
  handovers: DoorstepHandover[];
}

/** Anything doorstep on this day, or cash still out: otherwise the card stays hidden. */
export function hasDoorstepCash(d: DoorstepDay | undefined): d is DoorstepDay {
  return !!d && (d.collected > 0 || d.spent > 0 || d.held > 0 || d.handovers.length > 0);
}

const SHORT_REASONS = ['Gave change from it', 'Spent, no bill', 'Payment marked wrong', 'Lost'];

function personLine(p: DoorstepPerson): string {
  const parts = [
    p.collectedToday > 0 ? `Collected ${formatRupees(p.collectedToday)}` : null,
    p.spentToday > 0 ? `spent ${formatRupees(p.spentToday)}` : null,
    p.collectedToday > 0 || p.handedInToday > 0 ? `handed in ${formatRupees(p.handedInToday)}` : null,
  ].filter((x): x is string => x != null);
  if (parts.length === 0) return 'From an earlier day';
  const line = parts.join(' · ');
  return line.charAt(0).toUpperCase() + line.slice(1);
}

function handoverText(diff: number): string {
  if (diff === 0) return 'Full';
  return diff < 0 ? `${formatRupees(-diff)} short` : `${formatRupees(diff)} extra`;
}

/**
 * Doorstep cash on the drawer screen: what the team collected at customers' homes, who still
 * holds it, and each handover into the box. Taking cash is only for today's open drawer: the
 * money goes into the box it's handed into.
 */
export function DoorstepCashCard({
  doorstep,
  isToday,
  dayStatus,
  dayOpen,
  isOwner,
  onChanged,
}: {
  doorstep: DoorstepDay;
  isToday: boolean;
  dayStatus: 'not_started' | 'open' | 'closed';
  /** The day the handovers sit in is still open (they can be undone). */
  dayOpen: boolean;
  isOwner: boolean;
  onChanged: () => Promise<void> | void;
}) {
  const [taking, setTaking] = useState<DoorstepPerson | null>(null);
  const [undoing, setUndoing] = useState<DoorstepHandover | null>(null);
  const canTake = isToday && dayStatus === 'open';
  const takeHint =
    doorstep.held === 0 || canTake
      ? null
      : !isToday
        ? 'Doorstep cash goes into today’s drawer. Open Today to take it.'
        : dayStatus === 'not_started'
          ? 'Start the day first: the cash goes into today’s box.'
          : 'Today is closed. The owner can reopen it to take this cash.';

  return (
    <View style={[styles.panel, shadow('sm')]}>
      <View style={styles.head}>
        <View style={styles.headIcon}>
          <IconHome size={18} color={colors.amberDeep} />
        </View>
        <View style={styles.flex}>
          <Text style={styles.title}>Doorstep cash</Text>
          <Text style={styles.lead}>Collected at customers’ homes. It joins the box when it’s handed in.</Text>
        </View>
      </View>

      <View style={styles.stats}>
        <View style={styles.stat}>
          <Text style={styles.statLabel}>Collected</Text>
          <Text style={styles.statValue}>{formatRupees(doorstep.collected)}</Text>
          <Text style={styles.statSub}>
            {doorstep.jobs} wash{doorstep.jobs === 1 ? '' : 'es'}
            {doorstep.spent > 0 ? ` · ${formatRupees(doorstep.spent)} spent` : ''}
          </Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statLabel}>Handed in</Text>
          <Text style={styles.statValue}>{formatRupees(doorstep.handedIn)}</Text>
          <Text style={styles.statSub}>into this box</Text>
        </View>
        <View style={[styles.stat, doorstep.held > 0 && styles.statHeld]}>
          <Text style={styles.statLabel}>With the team</Text>
          <Text style={[styles.statValue, doorstep.held > 0 && styles.heldValue]}>{formatRupees(doorstep.held)}</Text>
          <Text style={styles.statSub}>right now</Text>
        </View>
      </View>

      {doorstep.people.map((p) => (
        <View key={p.userId} style={styles.person}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{p.name.slice(0, 1).toUpperCase()}</Text>
          </View>
          <View style={styles.flex}>
            <Text style={styles.personName} numberOfLines={1}>
              {p.name}
            </Text>
            <Text style={styles.personSub} numberOfLines={1}>
              {personLine(p)}
            </Text>
          </View>
          {p.held > 0 ? (
            canTake ? (
              <Pressable
                onPress={() => setTaking(p)}
                style={({ pressed }) => [styles.takeBtn, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={`Take ${formatRupees(p.held)} from ${p.name}`}
              >
                <Text style={styles.takeLabel}>Take</Text>
                <Text style={styles.takeValue}>{formatRupees(p.held)}</Text>
              </Pressable>
            ) : (
              <Pill label={`Holds ${formatRupees(p.held)}`} tone="amber" />
            )
          ) : (
            <Pill label="All in" tone="teal" />
          )}
        </View>
      ))}
      {takeHint ? <Text style={styles.helper}>{takeHint}</Text> : null}

      {doorstep.handovers.length > 0 ? (
        <View style={styles.log}>
          <Text style={styles.logTitle}>Handed in here</Text>
          {doorstep.handovers.map((h) => (
            <View key={h.id} style={styles.logRow}>
              <View style={styles.flex}>
                <Text style={[styles.logText, h.voided && styles.voided]}>
                  {h.collector} → {formatRupees(h.received)}
                  {h.receivedBy ? ` to ${h.receivedBy}` : ''} · {formatDateTime(h.at)}
                </Text>
                {h.note ? <Text style={styles.logNote}>“{h.note}”</Text> : null}
                {h.voided ? (
                  <Text style={styles.logNote}>
                    Undone{h.voided.by ? ` by ${h.voided.by}` : ''}
                    {h.voided.reason ? ` — “${h.voided.reason}”` : ''}
                  </Text>
                ) : null}
              </View>
              {h.voided ? (
                <Pill label="UNDONE" tone="slate" />
              ) : (
                <View style={styles.logRight}>
                  <Pill label={handoverText(h.difference)} tone={h.difference === 0 ? 'teal' : h.difference < 0 ? 'danger' : 'amber'} />
                  {isOwner && dayOpen ? (
                    <Pressable onPress={() => setUndoing(h)} hitSlop={6} accessibilityRole="button">
                      <Text style={styles.undo}>Undo</Text>
                    </Pressable>
                  ) : null}
                </View>
              )}
            </View>
          ))}
        </View>
      ) : null}

      <HandoverSheet person={taking} onClose={() => setTaking(null)} onDone={onChanged} />

      <ReasonSheet
        visible={!!undoing}
        title="Undo this handover?"
        subtitle={undoing ? `${undoing.collector} · ${formatRupees(undoing.received)}. The cash counts as with them again.` : undefined}
        confirmLabel="Undo handover"
        quickReasons={['Entered the wrong amount', 'Wrong person', 'Recorded twice']}
        onClose={() => setUndoing(null)}
        onConfirm={async (reason) => {
          if (!undoing) return null;
          try {
            const res = await api.cash.handover[':id'].void.$post({ param: { id: undoing.id }, json: { reason } });
            if (!res.ok) return apiErrorMessage(res, 'Couldn’t undo.');
            setUndoing(null);
            showToast('Handover undone');
            await onChanged();
            return null;
          } catch (e) {
            return e instanceof NetworkError ? 'This needs a connection.' : 'Couldn’t undo.';
          }
        }}
      />
    </View>
  );
}

/** Take a team member's doorstep cash: all of it, part now and the rest later, or short with a reason. */
function HandoverSheet({
  person,
  onClose,
  onDone,
}: {
  person: DoorstepPerson | null;
  onClose: () => void;
  onDone: () => Promise<void> | void;
}) {
  const [amountText, setAmountText] = useState('');
  const [rest, setRest] = useState<'still_held' | 'missing' | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (person) {
      setAmountText(String(person.held / 100));
      setRest(null);
      setNote('');
      setError(null);
      setBusy(false);
    }
  }, [person]);

  const held = person?.held ?? 0;
  const received = parseRupees(amountText);
  const amountOk = received != null && !Number.isNaN(received);
  const less = amountOk && received < held;
  const more = amountOk && received > held;
  const partial = less && rest === 'still_held' && received > 0;
  const diff = amountOk ? handoverDifference(partial ? received : held, received) : 0;
  const needsNote = diff !== 0 && (more || rest === 'missing');
  const noteOk = !needsNote || note.trim().length >= MIN_REASON_LENGTH;
  const ready = amountOk && (!less || rest != null) && noteOk && !(less && rest === 'still_held' && received === 0);

  const submit = async () => {
    if (!person || !ready || received == null) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.cash.handover.$post({
        json: {
          collectorId: person.userId,
          due: held,
          received,
          ...(less && rest ? { rest } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
        },
      });
      if (!res.ok) {
        setError(await apiErrorMessage(res, 'Couldn’t save.'));
        // What they hold changed (another handover or a payment): show the fresh figure.
        if (res.status === 409) await onDone();
        return;
      }
      showToast(`${formatRupees(received)} from ${person.name} is in the box`);
      onClose();
      await onDone();
    } catch (e) {
      setError(e instanceof NetworkError ? 'This needs a connection. Try again when you’re back online.' : 'Couldn’t save.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet
      visible={!!person}
      onClose={onClose}
      dismissable={!busy}
      title={person ? `Take cash from ${person.name}` : 'Take cash'}
      subtitle={person ? `${person.name} holds ${formatRupees(held)} from doorstep washes. Count what they hand you.` : undefined}
      footer={
        <Button
          label={amountOk ? `Received ${formatRupees(received)}` : 'Received'}
          size="lg"
          loading={busy}
          disabled={!ready}
          onPress={() => void submit()}
        />
      }
    >
      <View style={styles.sheetBody}>
        <MoneyInput
          value={amountText}
          onChange={(t) => {
            setAmountText(t);
            setError(null);
          }}
          placeholder="0"
          accessibilityLabel="Cash handed in, in rupees"
          right={
            amountOk ? (
              <View style={[styles.badge, !less && !more ? styles.badgeOk : less ? styles.badgeShort : styles.badgeOver]}>
                {!less && !more ? <IconCheck size={12} color={colors.white} /> : <IconAlert size={12} color={colors.white} />}
                <Text style={styles.badgeText} numberOfLines={1}>
                  {!less && !more ? 'All of it' : less ? `${formatRupees(held - received)} less` : `${formatRupees(received - held)} more`}
                </Text>
              </View>
            ) : null
          }
        />

        {less ? (
          <View style={styles.choiceBlock}>
            <Text style={styles.fieldLabel}>The other {formatRupees(held - received)}:</Text>
            <View style={styles.choices}>
              {(
                [
                  ['still_held', 'Still with them', 'They’ll bring it later'],
                  ['missing', 'Missing', 'Say what happened'],
                ] as const
              ).map(([key, label, sub]) => {
                const on = rest === key;
                const off = key === 'still_held' && received === 0;
                return (
                  <Pressable
                    key={key}
                    disabled={off}
                    onPress={() => setRest(key)}
                    style={({ pressed }) => [styles.choice, on && styles.choiceOn, off && styles.choiceOff, pressed && styles.pressed]}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on, disabled: off }}
                  >
                    <Text style={[styles.choiceLabel, on && styles.choiceLabelOn]}>{label}</Text>
                    <Text style={[styles.choiceSub, on && styles.choiceSubOn]}>{sub}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}

        {less && rest === 'missing' ? (
          <Text style={styles.helper}>
            Spent some on fuel or supplies with a bill? Add it as an expense paid from their doorstep cash
            instead, then take what’s left.
          </Text>
        ) : null}

        {needsNote ? (
          <View style={styles.choiceBlock}>
            <Text style={styles.fieldLabel}>{more ? 'Why is it more?' : 'What happened to it?'}</Text>
            <View style={styles.reasons}>
              {(more ? ['Tip from the customer', 'Payment marked wrong'] : SHORT_REASONS).map((r) => {
                const on = note === r;
                return (
                  <Pressable
                    key={r}
                    onPress={() => setNote(on ? '' : r)}
                    style={({ pressed }) => [styles.reason, on && styles.reasonOn, pressed && styles.pressed]}
                  >
                    {on ? <IconCheck size={12} color={colors.white} /> : null}
                    <Text style={[styles.reasonText, on && styles.reasonTextOn]}>{r}</Text>
                  </Pressable>
                );
              })}
            </View>
            <TextInput
              style={styles.noteInput}
              value={note}
              onChangeText={setNote}
              placeholder="Or write what happened"
              placeholderTextColor={colors.slate}
              maxLength={300}
              multiline
            />
          </View>
        ) : null}

        {partial ? (
          <Text style={styles.helper}>
            {formatRupees(held - received)} stays with {person?.name} and shows here until it’s handed in.
          </Text>
        ) : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pressed: { opacity: 0.75 },
  panel: { backgroundColor: colors.white, borderRadius: radius.xl, padding: spacing.md, gap: spacing.sm + 4 },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 2 },
  headIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.amberPale,
  },
  title: { ...typography.bodyStrong, fontSize: 16.5, color: colors.ink, fontWeight: '800' },
  lead: { ...typography.caption, fontSize: 12.5, color: colors.slateDeep, letterSpacing: 0 },

  stats: { flexDirection: 'row', gap: spacing.sm },
  stat: { flex: 1, borderRadius: radius.md, padding: spacing.sm + 2, gap: 1, backgroundColor: colors.surface },
  statHeld: { backgroundColor: colors.amberPale },
  statLabel: { ...typography.caption, fontSize: 11, color: colors.slateDeep, letterSpacing: 0 },
  statValue: { ...typography.heading, fontSize: 16.5, color: colors.ink },
  heldValue: { color: colors.amberDeep },
  statSub: { ...typography.caption, fontSize: 10.5, color: colors.slate, letterSpacing: 0 },

  person: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 2 },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.indigoPale,
  },
  avatarText: { ...typography.bodyStrong, fontSize: 14, color: colors.indigo, fontWeight: '800' },
  personName: { ...typography.bodyStrong, fontSize: 14.5, color: colors.ink, fontWeight: '700' },
  personSub: { ...typography.caption, fontSize: 12, color: colors.slateDeep, letterSpacing: 0 },
  takeBtn: {
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: radius.md,
    backgroundColor: colors.indigo,
  },
  takeLabel: { ...typography.caption, fontSize: 10.5, color: 'rgba(255,255,255,0.8)', letterSpacing: 0.3 },
  takeValue: { ...typography.bodyStrong, fontSize: 14, color: colors.white, fontWeight: '800' },
  helper: { ...typography.caption, fontSize: 12, color: colors.slate, letterSpacing: 0 },

  log: { gap: spacing.sm, paddingTop: spacing.xs, borderTopWidth: 1, borderTopColor: colors.border },
  logTitle: { ...typography.caption, fontSize: 11.5, color: colors.slateDeep, letterSpacing: 0.3, fontWeight: '700', paddingTop: spacing.sm },
  logRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  logRight: { alignItems: 'flex-end', gap: 4 },
  logText: { ...typography.caption, fontSize: 12.5, color: colors.ink, letterSpacing: 0, lineHeight: 18 },
  logNote: { ...typography.caption, fontSize: 12, color: colors.slateDeep, letterSpacing: 0, fontStyle: 'italic' },
  voided: { textDecorationLine: 'line-through', color: colors.slate },
  undo: { ...typography.caption, fontSize: 12, color: colors.danger, fontWeight: '700', letterSpacing: 0 },

  sheetBody: { gap: spacing.sm + 4 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    height: 30,
    borderRadius: radius.pill,
    maxWidth: '60%',
  },
  badgeOk: { backgroundColor: colors.teal },
  badgeShort: { backgroundColor: colors.danger },
  badgeOver: { backgroundColor: colors.amber },
  badgeText: { ...typography.caption, fontSize: 12, color: colors.white, fontWeight: '800', letterSpacing: 0 },
  choiceBlock: { gap: spacing.sm },
  fieldLabel: { ...typography.caption, fontSize: 12.5, color: colors.slateDeep, letterSpacing: 0 },
  choices: { flexDirection: 'row', gap: spacing.sm },
  choice: {
    flex: 1,
    padding: spacing.sm + 2,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    gap: 2,
  },
  choiceOn: { borderColor: colors.indigo, backgroundColor: colors.indigoPale },
  choiceOff: { opacity: 0.4 },
  choiceLabel: { ...typography.bodyStrong, fontSize: 14, color: colors.ink, fontWeight: '700' },
  choiceLabelOn: { color: colors.indigo },
  choiceSub: { ...typography.caption, fontSize: 11.5, color: colors.slateDeep, letterSpacing: 0 },
  choiceSubOn: { color: colors.indigo },
  reasons: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  reason: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    height: 32,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  reasonOn: { backgroundColor: colors.indigo, borderColor: colors.indigo },
  reasonText: { ...typography.caption, fontSize: 12.5, color: colors.slateDeep, letterSpacing: 0 },
  reasonTextOn: { color: colors.white, fontWeight: '700' },
  noteInput: {
    ...typography.body,
    minHeight: 48,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    color: colors.ink,
    fontSize: 14.5,
  },
  error: { ...typography.caption, fontSize: 13, color: colors.danger, letterSpacing: 0 },
});
