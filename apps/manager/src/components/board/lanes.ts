import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { IconBuilding, IconHome, IconStore, colors, type HeroPalette } from '@mana/ui';
import { api } from '../../api/client';
import { CacheKeys, readCache, writeCache } from '../../offline/cache';
import type { BoardJob } from '../../offline/types';

/** The three ways a branch washes, each a tab on the home screen. */
export type Lane = 'hub' | 'community' | 'doorstep';
export type LaneAvailability = Record<Lane, boolean>;

export const LANE_ORDER: readonly Lane[] = ['hub', 'community', 'doorstep'];

interface LaneMeta {
  label: string;
  /** Title of the slim bar once the hero scrolls away. */
  compactTitle: string;
  Icon: typeof IconStore;
  /** Text and icon colour of the selected tab. */
  accent: string;
  /** Hero tint; the hub keeps the brand indigo. */
  palette?: HeroPalette;
  /** The floating button's gradient; the hub keeps the brand button. */
  fabTint?: readonly string[];
}

export const LANE_META: Record<Lane, LaneMeta> = {
  hub: { label: 'Hub', compactTitle: 'At the hub', Icon: IconStore, accent: colors.indigo },
  community: {
    label: 'Communities',
    compactTitle: 'Communities',
    Icon: IconBuilding,
    accent: colors.tealDeep,
    palette: { colors: ['#0F766E', '#0B5753', '#062B28'], locations: [0, 0.55, 1], glowA: '#5EEAD4', glowB: '#14B8A6' },
    fabTint: ['#14B8A6', '#0F766E'],
  },
  doorstep: {
    label: 'Doorstep',
    compactTitle: 'Doorstep',
    Icon: IconHome,
    accent: '#0369A1',
    palette: { colors: ['#0369A1', '#0B4A75', '#0A2540'], locations: [0, 0.55, 1], glowA: '#7DD3FC', glowB: '#0EA5E9' },
    fabTint: ['#0EA5E9', '#0369A1'],
  },
};

const HUB_ONLY: LaneAvailability = { hub: true, community: false, doorstep: false };

/** Whether a board job belongs to a lane. Community plan washes done at the shop are hub jobs. */
export function inLane(job: Pick<BoardJob, 'deliveryMode'>, lane: Lane): boolean {
  if (lane === 'community') return false;
  return (job.deliveryMode === 'doorstep') === (lane === 'doorstep');
}

/**
 * The tabs to show. A lane appears when the branch is set up for it, or when it still has work on
 * the board (a doorstep job from before home washing was switched off must not vanish).
 */
export function visibleLanes(
  available: LaneAvailability,
  jobs: readonly Pick<BoardJob, 'deliveryMode'>[],
  communityActive: boolean,
): Lane[] {
  const hasDoorstepJobs = jobs.some((j) => j.deliveryMode === 'doorstep');
  const hasHubJobs = jobs.some((j) => j.deliveryMode !== 'doorstep');
  const lanes = LANE_ORDER.filter((lane) => {
    if (lane === 'hub') return available.hub || hasHubJobs;
    if (lane === 'doorstep') return available.doorstep || hasDoorstepJobs;
    return available.community || communityActive;
  });
  return lanes.length ? lanes : ['hub'];
}

const laneListeners = new Set<(lanes: LaneAvailability) => void>();

/** The branch's services just changed (How this branch washes › What this branch offers): every home screen updates its tabs now. */
export function announceLanes(lanes: LaneAvailability) {
  void writeCache(CacheKeys.lanes, lanes);
  for (const listener of laneListeners) listener(lanes);
}

/**
 * Which lanes this branch runs (what it offers, with its hub and team), plus the tab this phone
 * last had open.
 * Cached, so the home screen opens on the right tab with no signal.
 */
export function useBoardLanes() {
  const [available, setAvailable] = useState<LaneAvailability>(HUB_ONLY);
  const [saved, setSaved] = useState<Lane | null>(null);

  useEffect(() => {
    let alive = true;
    void Promise.all([readCache<LaneAvailability>(CacheKeys.lanes), readCache<Lane>(CacheKeys.boardLane)]).then(
      ([lanes, lane]) => {
        if (!alive) return;
        if (lanes) setAvailable(lanes);
        if (lane) setSaved(lane);
      },
    );
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    laneListeners.add(setAvailable);
    return () => {
      laneListeners.delete(setAvailable);
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      api.services.network
        .$get()
        .then((res) => (res.ok ? res.json() : null))
        .then((network) => {
          if (!alive || !network) return;
          // A server from before tabs: work them out from its delivery modes.
          const lanes: LaneAvailability = (network as { lanes?: LaneAvailability }).lanes ?? {
            hub: network.modes.includes('hub'),
            community: false,
            doorstep: network.homeWash && network.modes.includes('doorstep'),
          };
          setAvailable(lanes);
          void writeCache(CacheKeys.lanes, lanes);
        })
        .catch(() => undefined);
      return () => {
        alive = false;
      };
    }, []),
  );

  const choose = useCallback((lane: Lane) => {
    setSaved(lane);
    void writeCache(CacheKeys.boardLane, lane);
  }, []);

  return { available, saved, choose };
}
