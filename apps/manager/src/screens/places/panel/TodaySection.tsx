import React from 'react';
import { StyleSheet, View } from 'react-native';
import { formatClock, formatDay } from '@mana/domain';
import { IconAlert, IconCalendar, colors } from '@mana/ui';
import { BoardSectionHeader } from '../../../components/board/BoardSectionHeader';
import { formatTime } from '../../../utils/jobs';
import type { Overview, OverviewPlace } from '../shared';
import { ActionPill, Chip, PanelRow, ProgressRing, QuietRow, TEAL_MIST, plural } from './parts';
import type { Nav } from './types';

type Day = Overview['days'][number];

function statusOf(p: OverviewPlace) {
  const recorded = p.done + p.notFound + p.missed;
  const total = Math.max(p.due, recorded);
  const finished = total > 0 && recorded >= total;
  const who = p.washers.length ? p.washers.join(', ') : p.team.length ? p.team.join(', ') : 'No team set';
  if (finished) return { recorded, total, finished, label: `Finished${p.lastAt ? ` ${formatTime(p.lastAt)}` : ''}`, color: colors.tealDeep, who };
  if (p.startedAt) return { recorded, total, finished, label: `Washing · since ${formatTime(p.startedAt)}`, color: colors.water, who };
  return { recorded, total, finished, label: `Starts ${formatClock(p.washTime)}`, color: colors.slateDeep, who };
}

/** Today's community wash days: progress at a glance and one tap into the wash list. */
export function TodaySection({ today, next, nav }: { today: Day | undefined; next: Day | undefined; nav: Nav }) {
  if (!today) return null;
  const places = today.places;
  return (
    <View>
      <BoardSectionHeader title="Wash days today" count={places.length || undefined} />
      {places.length ? (
        places.map((p, i) => {
          const s = statusOf(p);
          return (
            <PanelRow
              key={p.id}
              first={i === 0}
              leading={<ProgressRing done={p.done} total={Math.max(p.due, p.done)} />}
              title={p.title}
              meta={`${plural(p.due, 'paid vehicle')} · ${formatClock(p.washTime)}`}
              status={{ label: s.label, color: s.color, extra: s.who }}
              right={
                s.finished ? (
                  <ActionPill label="Done" tone="soft" onPress={() => nav.navigate('PlaceDay', { placeId: p.id, day: today.day })} />
                ) : (
                  <ActionPill label="Open list" onPress={() => nav.navigate('PlaceDay', { placeId: p.id, day: today.day })} />
                )
              }
              footer={
                p.unpaid || p.notFound || p.missed || p.far ? (
                  <>
                    {p.unpaid ? <Chip label={`${p.unpaid} not paid · don’t wash`} tone="danger" /> : null}
                    {p.notFound ? <Chip label={`${p.notFound} not found`} tone="amber" /> : null}
                    {p.missed ? <Chip label={`${p.missed} missed`} tone="slate" /> : null}
                    {p.far ? (
                      <Chip label={`${p.far} away from the site`} tone="amber" icon={<IconAlert size={11} color={colors.amberDeep} />} />
                    ) : null}
                  </>
                ) : null
              }
              onPress={() => nav.navigate('PlaceDay', { placeId: p.id, day: today.day })}
              accessibilityLabel={`${p.title}: ${p.done} of ${p.due} washed, ${s.label}`}
            />
          );
        })
      ) : next ? (
        <PanelRow
          first
          leading={
            <View style={styles.calendar}>
              <IconCalendar size={20} color={colors.tealDeep} />
            </View>
          }
          title="No wash days today"
          meta={`Next: ${formatDay(next.day)} · ${next.places.map((p) => `${p.title} ${formatClock(p.washTime)}`).join(', ')}`}
          muted
        />
      ) : (
        <QuietRow first title="No wash days today" body="Make a community live and its wash days show here." />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  calendar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: TEAL_MIST,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
