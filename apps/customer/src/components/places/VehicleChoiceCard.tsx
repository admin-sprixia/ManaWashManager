import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatDuration, formatInr } from '@mana/domain';
import { IconCheck, IconClose, colors, radius, shadow } from '@mana/ui';
import type { MenuVehicleType, PlaceInfo } from '../../api/types';
import { partsFor, plansFor, servicesFor, upgradeLine, type Choice } from '../../places/pricing';
import { VehicleTypeArt } from '../VehicleTypePicker';

interface VehicleChoiceCardProps {
  info: PlaceInfo;
  type: MenuVehicleType;
  /** The registration number, for a vehicle the customer already has. */
  plate?: string | null;
  choice: Choice | null;
  onChange: (choice: Choice) => void;
  onRemove: () => void;
}

/** "4 × ₹994", or "3 × ₹994 and ₹992" when rounding leaves the last part different. */
function laterParts(rest: readonly { amount: number }[]): string {
  const head = rest.slice(0, -1);
  const last = rest[rest.length - 1];
  if (!last) return '';
  if (head.every((p) => p.amount === last.amount)) return `${rest.length} × ${formatInr(last.amount)}`;
  return `${head.length} × ${formatInr(head[0]!.amount)} and ${formatInr(last.amount)}`;
}

/** One vehicle being joined: its photo, then Plans (open first) or One wash, and how to pay. */
/** "35 min · Foam wash · Vacuum · Tyre shine" — time, then what's included (or the note). */
function serviceLine(service: { description: string | null; durationMin?: number | null; checklist?: string[] }): string | null {
  const detail = service.checklist?.length ? service.checklist.join(' · ') : service.description;
  return [service.durationMin ? formatDuration(service.durationMin) : null, detail].filter(Boolean).join(' · ') || null;
}

export function VehicleChoiceCard({ info, type, plate, choice, onChange, onRemove }: VehicleChoiceCardProps) {
  const plans = plansFor(info.menu, type.id);
  const services = servicesFor(info.menu, type.id);
  const tab = choice?.kind ?? (plans.length ? 'plan' : 'single');

  const pickTab = (next: 'plan' | 'single') => {
    if (next === tab) return;
    if (next === 'plan' && plans.length) {
      const p = plans.find((x) => x.plan.popular) ?? plans[0]!;
      onChange({ kind: 'plan', planId: p.plan.id, payMode: 'full' });
    } else if (next === 'single' && services.length) {
      onChange({ kind: 'single', serviceIds: [services[0]!.service.id] });
    }
  };

  const toggleService = (id: string) => {
    if (choice?.kind !== 'single') return onChange({ kind: 'single', serviceIds: [id] });
    const has = choice.serviceIds.includes(id);
    const next = has ? choice.serviceIds.filter((s) => s !== id) : [...choice.serviceIds, id];
    if (next.length) onChange({ kind: 'single', serviceIds: next });
  };

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <VehicleTypeArt type={type} style={styles.photo} />
        <View style={styles.headCopy}>
          <Text style={styles.name}>{type.name}</Text>
          {plate ? <Text style={styles.plate}>{plate}</Text> : null}
        </View>
        <Pressable onPress={onRemove} hitSlop={10} style={styles.remove} accessibilityRole="button" accessibilityLabel={`Remove ${type.name}`}>
          <IconClose size={16} color={colors.slate} />
        </Pressable>
      </View>

      {plans.length && services.length ? (
        <View style={styles.tabs} accessibilityRole="tablist">
          {(
            [
              ['plan', 'Plans'],
              ['single', 'One wash'],
            ] as const
          ).map(([key, label]) => (
            <Pressable
              key={key}
              onPress={() => pickTab(key)}
              style={[styles.tab, tab === key && styles.tabOn]}
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === key }}
            >
              <Text style={[styles.tabText, tab === key && styles.tabTextOn]}>{label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {tab === 'plan' ? (
        <View style={styles.options}>
          {plans.map((p) => {
            const selected = choice?.kind === 'plan' && choice.planId === p.plan.id;
            return (
              <Pressable
                key={p.plan.id}
                onPress={() => onChange({ kind: 'plan', planId: p.plan.id, payMode: choice?.kind === 'plan' ? choice.payMode : 'full' })}
                style={({ pressed }) => [styles.option, selected && styles.optionOn, pressed && styles.pressed]}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
              >
                <View style={[styles.radio, selected && styles.radioOn]}>{selected ? <View style={styles.radioDot} /> : null}</View>
                <View style={styles.optionCopy}>
                  <View style={styles.optionTitleRow}>
                    <Text style={styles.optionTitle}>{p.plan.name}</Text>
                    {p.plan.popular ? (
                      <View style={styles.popular}>
                        <Text style={styles.popularText}>Most popular</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={styles.optionMeta}>
                    {p.plan.washes} washes · {p.plan.months === 1 ? '1 month' : `${p.plan.months} months`} · {formatInr(Math.round(p.total / p.plan.washes))} a wash
                    {upgradeLine(p.plan) ? ` · ${upgradeLine(p.plan)}` : ''}
                  </Text>
                </View>
                <View style={styles.priceCol}>
                  <Text style={styles.price}>{formatInr(p.total)}</Text>
                  {p.listTotal > p.total ? <Text style={styles.save}>Save {formatInr(p.listTotal - p.total)}</Text> : null}
                </View>
              </Pressable>
            );
          })}
          {choice?.kind === 'plan'
            ? (() => {
                const priced = plans.find((p) => p.plan.id === choice.planId);
                if (!priced?.plan.allowParts) return null;
                const parts = partsFor(info, priced, 'parts');
                const rest = parts.slice(1);
                return (
                  <View style={styles.payModes}>
                    {(
                      [
                        ['full', 'Pay in full', formatInr(priced.total)],
                        ['parts', 'Pay in parts', `${formatInr(parts[0]!.amount)} now, then ${laterParts(rest)}`],
                      ] as const
                    ).map(([mode, label, detail]) => {
                      const selected = choice.payMode === mode;
                      return (
                        <Pressable
                          key={mode}
                          onPress={() => onChange({ ...choice, payMode: mode })}
                          style={[styles.payMode, selected && styles.optionOn]}
                          accessibilityRole="radio"
                          accessibilityState={{ selected }}
                        >
                          <Text style={[styles.payModeTitle, selected && styles.tabTextOn]}>{label}</Text>
                          <Text style={styles.payModeDetail}>{detail}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                );
              })()
            : null}
        </View>
      ) : (
        <View style={styles.options}>
          {services.map((s) => {
            const selected = choice?.kind === 'single' && choice.serviceIds.includes(s.service.id);
            return (
              <Pressable
                key={s.service.id}
                onPress={() => toggleService(s.service.id)}
                style={({ pressed }) => [styles.option, selected && styles.optionOn, pressed && styles.pressed]}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: selected }}
              >
                <View style={[styles.check, selected && styles.checkOn]}>{selected ? <IconCheck size={12} color={colors.white} /> : null}</View>
                <View style={styles.optionCopy}>
                  <Text style={styles.optionTitle}>
                    {s.service.name}
                    {s.service.popular ? <Text style={styles.optionPopular}>{'  ·  Most popular'}</Text> : null}
                  </Text>
                  {serviceLine(s.service) ? (
                    <Text style={styles.optionMeta} numberOfLines={2}>
                      {serviceLine(s.service)}
                    </Text>
                  ) : null}
                </View>
                <Text style={styles.price}>{formatInr(s.price)}</Text>
              </Pressable>
            );
          })}
          <Text style={styles.hint}>On the place’s next wash day. Tick more to add extras.</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    padding: 14,
    gap: 12,
    borderRadius: radius.lg,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: '#E9EDFC',
    ...shadow('sm'),
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  photo: { width: 64, height: 46, borderRadius: radius.sm, backgroundColor: colors.surface },
  headCopy: { flex: 1, gap: 2 },
  name: { fontSize: 16.5, fontWeight: '800', color: colors.ink },
  plate: { fontSize: 12, fontWeight: '800', letterSpacing: 0.8, color: colors.slateDeep },
  remove: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  tabs: { flexDirection: 'row', padding: 3, borderRadius: radius.md, backgroundColor: colors.surface },
  tab: { flex: 1, paddingVertical: 9, borderRadius: radius.sm, alignItems: 'center' },
  tabOn: { backgroundColor: colors.white, ...shadow('sm') },
  tabText: { fontSize: 14, fontWeight: '700', color: colors.slate },
  tabTextOn: { color: colors.indigoMid },
  options: { gap: 8 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  optionOn: { borderColor: colors.indigo, backgroundColor: '#F7F8FF' },
  pressed: { opacity: 0.85 },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: colors.indigoMist, alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: colors.indigo },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.indigo },
  check: { width: 20, height: 20, borderRadius: 6, borderWidth: 2, borderColor: colors.indigoMist, alignItems: 'center', justifyContent: 'center' },
  checkOn: { borderColor: colors.indigo, backgroundColor: colors.indigo },
  optionCopy: { flex: 1, gap: 2 },
  optionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  optionTitle: { fontSize: 15.5, fontWeight: '700', color: colors.ink },
  optionMeta: { fontSize: 12.5, color: colors.slateDeep },
  optionPopular: { fontSize: 11.5, fontWeight: '800', color: '#92400E' },
  popular: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: colors.amberPale },
  popularText: { fontSize: 11, fontWeight: '800', color: colors.amberDeep },
  priceCol: { alignItems: 'flex-end', gap: 2 },
  price: { fontSize: 16, fontWeight: '800', color: colors.ink },
  save: { fontSize: 11.5, fontWeight: '800', color: colors.teal },
  payModes: { flexDirection: 'row', gap: 8 },
  payMode: { flex: 1, padding: 10, gap: 2, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border },
  payModeTitle: { fontSize: 14, fontWeight: '800', color: colors.slateDeep },
  payModeDetail: { fontSize: 12, color: colors.slateDeep },
  hint: { fontSize: 12.5, color: colors.slate, paddingHorizontal: 2 },
});
