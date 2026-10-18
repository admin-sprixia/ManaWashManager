import { useEffect, useMemo, useState } from 'react';
import { PLACE_CAPACITY_MAX, type PlaceStatus } from '@mana/domain';
import { showToast } from '@mana/ui';
import { api, apiErrorMessage } from '../../../api/client';
import { readCache, removeCache, writeCache } from '../../../offline/cache';
import { failure, type PlaceDetail } from '../shared';
import { OWNER_CHECKS } from './options';

type Place = PlaceDetail['place'];
export type Approval = 'yes' | 'no';

/** The owner's half-finished review, kept on this phone until it's approved or sent back. */
interface SavedReview {
  days: string[];
  time: string;
  teamIds: string[];
  approval: Approval;
  capacity: string;
  checks: string[];
  savedAt: string;
}

const savedKey = (placeId: string) => `review.v1.${placeId}`;

/** What's chosen, in a form that compares equal when nothing really changed. */
const snapshot = (s: { days: string[]; time: string; teamIds: string[]; approval: Approval; capacity: string; status: PlaceStatus; checks: string[] }) =>
  JSON.stringify({ ...s, days: [...s.days].sort(), teamIds: [...s.teamIds].sort(), checks: [...s.checks].sort(), capacity: s.capacity.trim() });

export type SubmitResult = { ok: true; invited: number | null } | { ok: false };

/**
 * The owner's choices for a community — days, time, team, who can join, a daily limit and (once
 * live) its status — filled once from what's saved, checked, and sent as a go-live or a save.
 * A review can also be kept for later on this phone.
 */
export function useWashSettings(placeId: string, place: Place | null) {
  const live = place?.stage === 'live';
  const [days, setDays] = useState<string[]>([]);
  const [time, setTime] = useState('06:30');
  const [teamIds, setTeamIds] = useState<string[]>([]);
  const [approval, setApproval] = useState<Approval>('no');
  const [capacity, setCapacity] = useState('');
  const [status, setStatus] = useState<PlaceStatus>('active');
  /** The owner's checks before approving (a review only). */
  const [checks, setChecks] = useState<string[]>([]);
  const [filled, setFilled] = useState(false);
  /** What was on screen when it opened (or was last saved for later), to spot unsaved changes. */
  const [baseline, setBaseline] = useState<string | null>(null);
  const [restoredAt, setRestoredAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!place || filled) return;
    setFilled(true);
    const first = place.setup.slots[0];
    // A draft starts from the residents' 1st choice; a live community from what it runs on.
    const start = {
      days: (live || !first ? place.washDays : first.days).map(String),
      time: live || !first ? place.washTime : first.time,
      teamIds: place.setup.team.map((t) => t.id),
      approval: (place.needsApproval ? 'yes' : 'no') as Approval,
      capacity: place.capacity != null ? String(place.capacity) : '',
      status: place.status,
      checks: [] as string[],
    };
    const apply = (s: typeof start) => {
      setDays(s.days);
      setTime(s.time);
      setTeamIds(s.teamIds);
      setApproval(s.approval);
      setCapacity(s.capacity);
      setStatus(s.status);
      setChecks(s.checks);
      setBaseline(snapshot(s));
    };
    apply(start);
    if (live) return;
    void readCache<SavedReview>(savedKey(placeId)).then((saved) => {
      if (!saved) return;
      apply({ ...start, days: saved.days, time: saved.time, teamIds: saved.teamIds, approval: saved.approval, capacity: saved.capacity, checks: saved.checks });
      setRestoredAt(saved.savedAt);
    });
  }, [place, filled, live, placeId]);

  const current = useMemo(
    () => snapshot({ days, time, teamIds, approval, capacity, status, checks }),
    [days, time, teamIds, approval, capacity, status, checks],
  );
  const dirty = baseline != null && current !== baseline;

  const capacityValue = capacity.trim() ? Number(capacity) : null;
  const capacityError =
    capacityValue != null && (!Number.isInteger(capacityValue) || capacityValue < 1 || capacityValue > PLACE_CAPACITY_MAX)
      ? `1 to ${PLACE_CAPACITY_MAX}, or leave it empty for no limit.`
      : null;

  const checksDone = OWNER_CHECKS.every((c) => checks.includes(c.key));
  const toggleCheck = (key: string) => setChecks((all) => (all.includes(key) ? all.filter((k) => k !== key) : [...all, key]));

  /** Keeps the review on this phone, to finish later. */
  const saveForLater = async () => {
    const saved: SavedReview = { days, time, teamIds, approval, capacity, checks, savedAt: new Date().toISOString() };
    await writeCache(savedKey(placeId), saved);
    setBaseline(current);
    setRestoredAt(saved.savedAt);
    showToast('Saved on this phone · finish it any time', 'success');
  };

  /** Drops a saved review (once it's approved, sent back, or the owner starts over). */
  const clearSaved = async () => {
    await removeCache(savedKey(placeId));
    setRestoredAt(null);
  };

  /** Saves for real; on success the caller leaves the screen. */
  const submit = async (): Promise<SubmitResult> => {
    const fail = (message: string): SubmitResult => {
      setError(message);
      return { ok: false };
    };
    setError(null);
    if (!days.length) return fail('Pick at least one wash day.');
    if (capacityError) return fail(`Vehicles per wash day: ${capacityError}`);
    if (!live && !checksDone) return fail('Tick every check under Approve before making it live.');
    const values = { washDays: days.map(Number).sort(), washTime: time, needsApproval: approval === 'yes', capacity: capacityValue };
    setBusy(true);
    try {
      if (live) {
        const [a, b] = await Promise.all([
          api.places[':id'].$patch({ param: { id: placeId }, json: { ...values, status } }),
          api.places[':id'].team.$put({ param: { id: placeId }, json: { userIds: teamIds } }),
        ]);
        if (!a.ok) return fail(await apiErrorMessage(a, 'Couldn’t save.'));
        if (!b.ok) return fail(await apiErrorMessage(b, 'Couldn’t save the team.'));
        setBaseline(current);
        showToast('Saved', 'success');
        return { ok: true, invited: null };
      }
      const res = await api.places[':id']['go-live'].$post({ param: { id: placeId }, json: { ...values, teamUserIds: teamIds } });
      if (!res.ok) return fail(await apiErrorMessage(res, 'Couldn’t make it live.'));
      const { invited } = await res.json();
      setBaseline(current);
      await clearSaved();
      return { ok: true, invited };
    } catch (e) {
      return fail(failure(e));
    } finally {
      setBusy(false);
    }
  };

  return {
    live,
    days,
    setDays,
    time,
    setTime,
    teamIds,
    setTeamIds,
    approval,
    setApproval,
    capacity,
    setCapacity,
    capacityError,
    status,
    setStatus,
    checks,
    toggleCheck,
    checksDone,
    dirty,
    restoredAt,
    saveForLater,
    clearSaved,
    busy,
    error,
    submit,
  };
}

export type WashSettings = ReturnType<typeof useWashSettings>;
