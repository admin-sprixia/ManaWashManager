import { formatClock, type JobStatus } from '@mana/domain';
import type { BoardJob } from '../../offline/types';
import { activityAt, isToday } from '../../utils/jobs';
import { formatRupees } from '../../utils/format';
import type { HeroFigure } from './BoardHeader';
import type { LaneBadge } from './LaneTabs';
import { LANE_META, inLane, type Lane } from './lanes';
import type { useCommunityToday } from './useCommunityToday';

type CommunityToday = ReturnType<typeof useCommunityToday>;

const OPEN: readonly JobStatus[] = ['waiting', 'washing', 'ready'];

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export interface JobStats {
  cars: number;
  revenue: number;
  open: number;
}

/** Today's washes and money count on the day they were paid — the same clock as Reports. */
export function jobStats(jobs: readonly BoardJob[]): JobStats {
  const paidToday = jobs.filter((j) => j.status === 'paid' && isToday(activityAt(j)));
  return {
    cars: paidToday.length,
    revenue: paidToday.reduce((sum, j) => sum + j.total, 0),
    open: jobs.filter((j) => OPEN.includes(j.status)).length,
  };
}

export interface SectionDef {
  key: string;
  title: string;
  statuses: JobStatus[];
  todayOnly?: boolean;
}

export function sectionDefs(lane: Lane): SectionDef[] {
  const doorstep = lane === 'doorstep';
  return [
    { key: 'ready', title: doorstep ? 'Washed · collect payment' : 'Ready for pickup', statuses: ['ready'] },
    { key: 'active', title: doorstep ? 'Booked & washing' : 'In progress', statuses: ['washing', 'waiting'] },
    { key: 'done', title: 'Paid today', statuses: ['paid'], todayOnly: true },
    { key: 'void', title: 'Voided today', statuses: ['void'], todayOnly: true },
  ];
}

/** What the board says when a jobs tab has nothing yet. */
export const LANE_EMPTY: Record<Exclude<Lane, 'community'>, { title: string; body: string }> = {
  hub: { title: 'No washes yet today', body: 'Tap New Wash when the first vehicle rolls in.' },
  doorstep: { title: 'No doorstep washes yet', body: 'Tap Doorstep wash to book a wash at a customer’s home.' },
};

/** The floating button for each tab. */
export const LANE_FAB: Record<Lane, string> = {
  hub: 'New Wash',
  community: 'Add community',
  doorstep: 'Doorstep wash',
};

export interface LaneHero {
  figures: HeroFigure[];
  tagline: string | null;
  taglineWarn: boolean;
  compactTitle: string;
  compactSummary: string;
}

/** The hero's numbers and line for the selected tab, and the slim bar that replaces it. */
export function laneHero({
  lane,
  multi,
  isOwner,
  stats,
  community,
}: {
  lane: Lane;
  multi: boolean;
  isOwner: boolean;
  stats: JobStats;
  community: CommunityToday;
}): LaneHero {
  if (lane === 'community') {
    const { places, due, done, unpaid, review, far } = community;
    return {
      figures: [
        { label: 'Washed today', value: due ? `${done}/${due}` : String(done) },
        { label: 'Places today', value: String(places.length) },
        isOwner ? { label: 'To approve', value: String(review) } : { label: 'Not paid', value: String(unpaid) },
      ],
      tagline: far
        ? `${plural(far, 'wash', 'washes')} recorded away from the community`
        : places.length
          ? places.map((p) => `${p.title} ${formatClock(p.washTime)}`).join('  ·  ')
          : 'No community washes today',
      taglineWarn: far > 0,
      compactTitle: LANE_META.community.compactTitle,
      compactSummary: due ? `${done} of ${due} washed today` : places.length ? plural(places.length, 'place') + ' today' : 'No washes today',
    };
  }

  const doorstep = lane === 'doorstep';
  const openLabel = doorstep ? 'Open' : 'In shop';
  const figures: HeroFigure[] = [
    { label: 'Washes', value: String(stats.cars) },
    ...(isOwner ? [{ label: 'Revenue', value: formatRupees(stats.revenue) }] : []),
    { label: openLabel, value: String(stats.open) },
  ];
  const washes = plural(stats.cars, 'wash', 'washes');
  const tagline = doorstep
    ? stats.open
      ? `${plural(stats.open, 'home visit')} open right now`
      : 'Washes at customers’ homes'
    : !multi
      ? null
      : stats.open
        ? `${plural(stats.open, 'vehicle')} at the hub right now`
        : stats.cars
          ? `${washes} done at the hub today`
          : 'Ready for the first car of the day';
  return {
    figures,
    tagline,
    taglineWarn: false,
    compactTitle: multi ? LANE_META[lane].compactTitle : 'Today',
    compactSummary: isOwner ? `${washes} · ${formatRupees(stats.revenue)}` : `${washes} · ${stats.open} ${doorstep ? 'open' : 'in shop'}`,
  };
}

/** Small counts on the tabs: open cars per jobs tab; approvals (or what's left today) for communities. */
export function laneBadges(jobs: readonly BoardJob[], community: CommunityToday, isOwner: boolean): Partial<Record<Lane, LaneBadge>> {
  const open = (lane: Lane) => jobs.filter((j) => inLane(j, lane) && OPEN.includes(j.status)).length;
  const left = Math.max(0, community.due - community.done);
  return {
    hub: { count: open('hub'), tone: 'soft' },
    doorstep: { count: open('doorstep'), tone: 'soft' },
    community: isOwner && community.review > 0 ? { count: community.review, tone: 'alert' } : { count: left, tone: 'soft' },
  };
}
