import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ScreenContainer } from '../components/ScreenContainer';
import { ScreenHeader } from '../components/ScreenHeader';
import { Button } from '../components/Button';
import { IconAlert, IconBug, IconChevronDown, IconShare, IconShield, IconSync } from '../components/Icons';
import { colors, radius, spacing, typography } from '../theme';
import { api, apiErrorMessage } from '../api/client';
import { NetworkError } from '../api/network';
import { useShop } from '../offline/ShopProvider';
import { APP_VERSION } from '../config/app';
import { formatDateTime, formatDay, istDate } from '../utils/format';
import { emailSupport } from '../utils/support';
import type { RootStackParamList } from '../navigation/RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'ErrorLog'>;

interface ErrorRow {
  id: string;
  source: 'app' | 'api';
  message: string;
  stack: string | null;
  context: string | null;
  appVersion: string | null;
  createdAt: string;
}

type Filter = 'all' | 'app' | 'api';

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

const SOURCE = {
  app: { label: 'App', bg: '#FEF3C7', fg: colors.amberDeep, solid: colors.amber },
  api: { label: 'Server', bg: '#FEE2E2', fg: colors.danger, solid: colors.danger },
} as const;

function istParts(iso: string): { date: string; time: string } {
  const shifted = new Date(new Date(iso).getTime() + IST_OFFSET_MS);
  const h = shifted.getUTCHours();
  const m = shifted.getUTCMinutes();
  return {
    date: shifted.toISOString().slice(0, 10),
    time: `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`,
  };
}

function ago(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function dayTitle(date: string): string {
  if (date === istDate(0)) return 'Today';
  if (date === istDate(1)) return 'Yesterday';
  return formatDay(date);
}

function reportText(r: ErrorRow): string {
  return [
    `[${SOURCE[r.source].label}] ${formatDateTime(r.createdAt)}${r.appVersion ? ` · v${r.appVersion}` : ''}`,
    r.message,
    r.context ? `Context: ${r.context}` : null,
    r.stack ? `\n${r.stack}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

/** App crashes and server errors from the last 90 days — for sending to whoever maintains the app. */
export function ErrorLogScreen({ navigation }: Props) {
  const [rows, setRows] = useState<ErrorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const { info, markErrorsSeen } = useShop();

  const load = useCallback(async () => {
    try {
      const res = await api.shop.errors.$get();
      if (!res.ok) throw new Error(await apiErrorMessage(res, 'Couldn’t load the error log.'));
      setRows((await res.json()) as ErrorRow[]);
      setError(null);
    } catch (e) {
      setError(e instanceof NetworkError ? 'The error log needs a connection.' : (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    markErrorsSeen();
  }, [load, markErrorsSeen]);

  const counts = useMemo(
    () => ({ all: rows.length, app: rows.filter((r) => r.source === 'app').length, api: rows.filter((r) => r.source === 'api').length }),
    [rows],
  );
  const visible = useMemo(() => (filter === 'all' ? rows : rows.filter((r) => r.source === filter)), [rows, filter]);

  const groups = useMemo(() => {
    const out: { date: string; items: ErrorRow[] }[] = [];
    for (const r of visible) {
      const { date } = istParts(r.createdAt);
      const last = out[out.length - 1];
      if (last && last.date === date) last.items.push(r);
      else out.push({ date, items: [r] });
    }
    return out;
  }, [visible]);

  const week = useMemo(() => {
    const days = Array.from({ length: 7 }, (_, i) => istDate(6 - i));
    const byDay = new Map<string, number>();
    for (const r of rows) {
      const { date } = istParts(r.createdAt);
      byDay.set(date, (byDay.get(date) ?? 0) + 1);
    }
    return days.map((d) => ({ date: d, n: byDay.get(d) ?? 0 }));
  }, [rows]);
  const weekMax = Math.max(1, ...week.map((d) => d.n));
  const weekTotal = week.reduce((s, d) => s + d.n, 0);

  const shareAll = () =>
    void emailSupport(
      `MANA error log — ${info?.name ?? 'shop'}`,
      [
        `MANA error log — ${info?.name ?? 'shop'} · app v${APP_VERSION}`,
        `${visible.length} entr${visible.length === 1 ? 'y' : 'ies'}`,
        '',
        ...visible.slice(0, 30).map((r) => `${reportText(r)}\n${'─'.repeat(20)}`),
      ].join('\n'),
    );

  return (
    <ScreenContainer noPadding>
      <View style={styles.headerPad}>
        <ScreenHeader
          title="Error log"
          onBack={() => navigation.goBack()}
          right={
            rows.length ? (
              <Pressable
                onPress={shareAll}
                style={({ pressed }) => [styles.headerBtn, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel="Email the error log to support"
              >
                <IconShare size={15} color={colors.white} />
                <Text style={styles.headerBtnText}>Send</Text>
              </Pressable>
            ) : undefined
          }
        />
      </View>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load().finally(() => setRefreshing(false));
            }}
            tintColor={colors.water}
            colors={[colors.water]}
          />
        }
      >
        {loading ? (
          <ActivityIndicator style={styles.loader} color={colors.water} />
        ) : error ? (
          <View style={styles.stateBox}>
            <View style={styles.stateIcon}>
              <IconSync size={26} color={colors.waterDeep} />
            </View>
            <Text style={styles.stateText}>{error}</Text>
            <Button label="Try again" variant="secondary" onPress={() => void load()} />
          </View>
        ) : rows.length === 0 ? (
          <LinearGradient colors={['#14B8A6', '#0D9488']} start={{ x: 0, y: 0 }} end={{ x: 0.9, y: 1 }} style={styles.cleanHero}>
            <View pointerEvents="none" style={styles.orbLarge} />
            <View style={styles.cleanIcon}>
              <IconShield size={30} color={colors.white} />
            </View>
            <Text style={styles.cleanTitle}>All clear</Text>
            <Text style={styles.cleanBody}>
              Nothing has gone wrong in the app or on the server in the last 90 days.
            </Text>
            <Text style={styles.cleanMeta}>App version {APP_VERSION}</Text>
          </LinearGradient>
        ) : (
          <>
            {/* Summary */}
            <View style={styles.summary}>
              <View style={styles.summaryTop}>
                <View style={styles.summaryCopy}>
                  <Text style={styles.summaryValue}>{rows.length}</Text>
                  <Text style={styles.summaryLabel}>
                    error{rows.length === 1 ? '' : 's'} in 90 days · last {ago(rows[0]!.createdAt)}
                  </Text>
                </View>
                <View style={styles.chart}>
                  {week.map((d) => (
                    <View key={d.date} style={styles.chartCol}>
                      <View style={styles.chartTrack}>
                        <View
                          style={[
                            styles.chartBar,
                            { height: `${(d.n / weekMax) * 100}%`, backgroundColor: d.n ? colors.danger : 'transparent' },
                          ]}
                        />
                      </View>
                      <Text style={[styles.chartDay, d.date === istDate(0) && styles.chartToday]}>
                        {formatDay(d.date).slice(0, 1)}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
              <Text style={styles.weekNote}>
                {weekTotal === 0 ? 'None in the last 7 days 🎉' : `${weekTotal} in the last 7 days`}
              </Text>
              <View style={styles.segment}>
                {(['all', 'app', 'api'] as Filter[]).map((f) => {
                  const on = filter === f;
                  return (
                    <Pressable
                      key={f}
                      onPress={() => {
                        setFilter(f);
                        setOpen(null);
                      }}
                      style={[styles.segmentBtn, on && styles.segmentOn]}
                      accessibilityRole="tab"
                      accessibilityState={{ selected: on }}
                    >
                      <Text style={[styles.segmentText, on && styles.segmentTextOn]}>
                        {f === 'all' ? 'All' : SOURCE[f].label}
                      </Text>
                      <View style={[styles.segmentCount, on && styles.segmentCountOn]}>
                        <Text style={[styles.segmentCountText, on && styles.segmentCountTextOn]}>{counts[f]}</Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {visible.length === 0 ? (
              <Text style={styles.emptyFilter}>
                No {filter === 'app' ? 'app' : 'server'} errors — everything here came from the{' '}
                {filter === 'app' ? 'server' : 'app'}.
              </Text>
            ) : (
              groups.map((g) => (
                <View key={g.date}>
                  <View style={styles.sectionHead}>
                    <Text style={styles.sectionTitle}>{dayTitle(g.date)}</Text>
                    <Text style={styles.sectionMeta}>
                      {g.items.length} error{g.items.length === 1 ? '' : 's'}
                    </Text>
                  </View>
                  <View style={styles.band}>
                    {g.items.map((r, i) => {
                      const expanded = open === r.id;
                      const tone = SOURCE[r.source];
                      const fatal = r.context === 'fatal';
                      return (
                        <Pressable
                          key={r.id}
                          onPress={() => setOpen(expanded ? null : r.id)}
                          android_ripple={{ color: colors.waterPale }}
                          style={[styles.row, i < g.items.length - 1 && styles.divider, expanded && styles.rowOpen]}
                          accessibilityRole="button"
                          accessibilityState={{ expanded }}
                        >
                          <View style={styles.rowTop}>
                            <View style={[styles.rowIcon, { backgroundColor: tone.bg }]}>
                              {r.source === 'app' ? (
                                <IconBug size={17} color={tone.fg} />
                              ) : (
                                <IconAlert size={17} color={tone.fg} />
                              )}
                            </View>
                            <View style={styles.rowCopy}>
                              <Text style={styles.message} numberOfLines={expanded ? undefined : 2}>
                                {r.message}
                              </Text>
                              <View style={styles.metaRow}>
                                <Text style={[styles.sourceTag, { color: tone.fg }]}>{tone.label}</Text>
                                <Text style={styles.meta}>· {istParts(r.createdAt).time}</Text>
                                {r.appVersion ? <Text style={styles.meta}>· v{r.appVersion}</Text> : null}
                                {fatal ? (
                                  <View style={styles.fatalTag}>
                                    <Text style={styles.fatalText}>Crash</Text>
                                  </View>
                                ) : null}
                              </View>
                            </View>
                            <View style={[styles.chevron, expanded && styles.chevronOpen]}>
                              <IconChevronDown size={16} color={colors.slate} />
                            </View>
                          </View>

                          {expanded ? (
                            <View style={styles.details}>
                              {r.context && !fatal ? (
                                <View style={styles.contextRow}>
                                  <Text style={styles.detailLabel}>Where</Text>
                                  <Text style={styles.contextText} selectable>
                                    {r.context}
                                  </Text>
                                </View>
                              ) : null}
                              {r.stack ? (
                                <View style={styles.codeBlock}>
                                  <Text style={styles.codeLabel}>Technical details</Text>
                                  <Text style={styles.code} selectable>
                                    {r.stack}
                                  </Text>
                                </View>
                              ) : (
                                <Text style={styles.meta}>No technical details were recorded.</Text>
                              )}
                              <Pressable
                                onPress={() =>
                                  void emailSupport(
                                    `MANA error — ${info?.name ?? 'shop'}`,
                                    `${info?.name ?? 'Shop'} · app v${APP_VERSION}\n\n${reportText(r)}`,
                                  )
                                }
                                style={({ pressed }) => [styles.shareRowBtn, pressed && styles.pressed]}
                                accessibilityRole="button"
                              >
                                <IconShare size={14} color={colors.waterDeep} />
                                <Text style={styles.shareRowText}>Send this to support</Text>
                              </Pressable>
                            </View>
                          ) : null}
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ))
            )}
            <Text style={styles.footnote}>
              Tap an entry for details. App errors are saved on the phone and sent when it’s back online.
              Entries older than 90 days are removed automatically.
            </Text>
          </>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  headerPad: { paddingHorizontal: spacing.md },
  scroll: { paddingBottom: spacing.xxl, gap: spacing.lg },
  pressed: { opacity: 0.7 },
  loader: { marginTop: spacing.xxl },
  headerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 36,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    backgroundColor: colors.water,
  },
  headerBtnText: { ...typography.label, fontSize: 13.5, color: colors.white },

  stateBox: { alignItems: 'center', paddingHorizontal: spacing.xl, paddingVertical: spacing.xl, gap: spacing.sm },
  stateIcon: {
    width: 64,
    height: 64,
    borderRadius: 22,
    backgroundColor: colors.waterPale,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  stateText: { ...typography.body, fontSize: 14.5, color: colors.slateDeep, textAlign: 'center', lineHeight: 21 },

  cleanHero: {
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xl + 4,
    gap: spacing.sm,
    overflow: 'hidden',
  },
  orbLarge: {
    position: 'absolute',
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: 'rgba(255,255,255,0.12)',
    top: -90,
    right: -70,
  },
  cleanIcon: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  cleanTitle: { ...typography.display, fontSize: 30, color: colors.white },
  cleanBody: { ...typography.body, fontSize: 15, color: 'rgba(255,255,255,0.92)', textAlign: 'center', lineHeight: 21 },
  cleanMeta: { ...typography.caption, fontSize: 12, color: 'rgba(255,255,255,0.75)', letterSpacing: 0, marginTop: 4 },

  summary: {
    backgroundColor: colors.white,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  summaryTop: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.md },
  summaryCopy: { flex: 1, gap: 2 },
  summaryValue: { ...typography.display, fontSize: 40, color: colors.waterInk, letterSpacing: -1 },
  summaryLabel: { ...typography.caption, fontSize: 12.5, color: colors.slateDeep, letterSpacing: 0 },
  chart: { flexDirection: 'row', gap: 5, alignItems: 'flex-end' },
  chartCol: { alignItems: 'center', gap: 4 },
  chartTrack: {
    width: 12,
    height: 44,
    borderRadius: 6,
    backgroundColor: colors.surface,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  chartBar: { width: '100%', borderRadius: 6, minHeight: 0 },
  chartDay: { ...typography.caption, fontSize: 10, color: colors.slate, fontWeight: '700', letterSpacing: 0 },
  chartToday: { color: colors.water },
  weekNote: { ...typography.label, fontSize: 13, color: colors.slateDeep },
  segment: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    padding: 3,
    marginTop: spacing.xs,
  },
  segmentBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 36,
    borderRadius: radius.pill,
  },
  segmentOn: { backgroundColor: colors.waterInk },
  segmentText: { ...typography.label, fontSize: 13.5, color: colors.slateDeep },
  segmentTextOn: { color: colors.white },
  segmentCount: {
    minWidth: 20,
    height: 18,
    paddingHorizontal: 5,
    borderRadius: 9,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentCountOn: { backgroundColor: 'rgba(255,255,255,0.22)' },
  segmentCountText: { ...typography.caption, fontSize: 11, fontWeight: '800', color: colors.slateDeep, letterSpacing: 0 },
  segmentCountTextOn: { color: colors.white },
  emptyFilter: {
    ...typography.body,
    fontSize: 14,
    color: colors.slateDeep,
    textAlign: 'center',
    paddingHorizontal: spacing.xl,
  },

  sectionHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  sectionTitle: { ...typography.heading, fontSize: 17, color: colors.waterInk, letterSpacing: -0.2 },
  sectionMeta: { ...typography.caption, fontSize: 12, color: colors.slate, letterSpacing: 0 },
  band: {
    backgroundColor: colors.white,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  row: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 6, gap: spacing.sm + 4 },
  rowOpen: { backgroundColor: '#FAFCFF' },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm + 4 },
  rowIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  rowCopy: { flex: 1, gap: 4 },
  message: { ...typography.bodyStrong, fontSize: 15, color: colors.waterInk, lineHeight: 20 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap' },
  sourceTag: { ...typography.caption, fontSize: 12, fontWeight: '800', letterSpacing: 0 },
  meta: { ...typography.caption, fontSize: 12, color: colors.slate, letterSpacing: 0 },
  fatalTag: { paddingHorizontal: 7, height: 18, borderRadius: 9, backgroundColor: colors.danger, justifyContent: 'center' },
  fatalText: { ...typography.caption, fontSize: 10.5, fontWeight: '800', color: colors.white, letterSpacing: 0.2 },
  chevron: { paddingTop: 8 },
  chevronOpen: { transform: [{ rotate: '180deg' }] },

  details: { gap: spacing.sm + 2, paddingLeft: 36 + spacing.sm + 4 },
  contextRow: { gap: 2 },
  detailLabel: { ...typography.caption, fontSize: 11.5, color: colors.slate, fontWeight: '700', letterSpacing: 0.3 },
  contextText: { ...typography.body, fontSize: 13.5, color: colors.slateDeep },
  codeBlock: { backgroundColor: '#0B1F33', borderRadius: radius.md, padding: spacing.sm + 4, gap: 6 },
  codeLabel: { ...typography.caption, fontSize: 11, color: '#7DD3FC', fontWeight: '800', letterSpacing: 0.4 },
  code: { fontFamily: 'monospace', fontSize: 11, lineHeight: 16, color: '#E2E8F0' },
  shareRowBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    height: 34,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    backgroundColor: colors.waterPale,
  },
  shareRowText: { ...typography.label, fontSize: 13, color: colors.waterDeep },

  footnote: {
    ...typography.caption,
    fontSize: 12.5,
    color: colors.slate,
    paddingHorizontal: spacing.md,
    letterSpacing: 0,
    lineHeight: 18,
  },
});
