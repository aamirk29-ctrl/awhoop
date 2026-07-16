'use client';

// Shared WHOOP token store + data access. Extracted from whoop-card.tsx so
// every consumer (the recovery card, nutrition targets, anything later) goes
// through ONE refresh path.
//
// Why that matters: WHOOP rotates the refresh token on every refresh — the old
// one is invalidated immediately. Two components each running their own refresh
// would race, the loser would present a dead token, and both would 401 out. So
// `refreshTokens` is single-flight: concurrent callers share one in-flight
// rotation and all receive its result.
//
// Token shape and the `whoop_tokens_v1` key are unchanged from the original
// card, so already-connected sessions keep working.

import * as React from 'react';
import { storeGet, storeSet, storeRemove, useStorageTick } from './storage';
import { dateToKey } from './dates';
import { FLOOR_WINDOW } from './nutrition';

export const WHOOP_TOKENS_KEY = 'whoop_tokens_v1';
export const WHOOP_CLIENT_ID = '719b8967-05b8-433a-bbf7-11dec624dba6';
export const WHOOP_SCOPES =
  'read:recovery read:sleep read:workout read:cycles read:profile read:body_measurement offline';

export type WhoopTokens = { access: string; refresh?: string; expires?: number };

export function loadTokens(): WhoopTokens | null {
  return storeGet<WhoopTokens>(WHOOP_TOKENS_KEY);
}

export function saveTokens(t: WhoopTokens) {
  storeSet(WHOOP_TOKENS_KEY, t);
}

export function clearTokens() {
  storeRemove(WHOOP_TOKENS_KEY);
}

export function isConnected(): boolean {
  return !!loadTokens()?.access;
}

/** Pull tokens out of the OAuth callback's URL fragment, if present. */
export function captureTokensFromHash(): WhoopTokens | null {
  if (typeof window === 'undefined' || !location.hash.includes('whoop_access')) return null;
  const h = new URLSearchParams(location.hash.slice(1));
  const access = h.get('whoop_access');
  if (!access) return null;
  const t: WhoopTokens = {
    access,
    refresh: h.get('whoop_refresh') || undefined,
    expires: Number(h.get('whoop_expires')) || Date.now() + 3500e3,
  };
  saveTokens(t);
  history.replaceState(null, '', location.pathname + location.search);
  return t;
}

export function buildAuthUrl(): string {
  return (
    'https://api.prod.whoop.com/oauth/oauth2/auth' +
    `?client_id=${encodeURIComponent(WHOOP_CLIENT_ID)}` +
    `&redirect_uri=${encodeURIComponent(`${window.location.origin}/api/whoop-callback`)}` +
    '&response_type=code' +
    `&scope=${encodeURIComponent(WHOOP_SCOPES)}` +
    `&state=${Math.random().toString(36).slice(2)}`
  );
}

// ---- single-flight refresh --------------------------------------------------

let refreshInFlight: Promise<WhoopTokens | null> | null = null;

/** Rotate the refresh token. Concurrent callers share one in-flight request —
 *  see the module header for why duplicating this would 401. */
export function refreshTokens(): Promise<WhoopTokens | null> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    // Re-read from storage rather than trusting a caller-held copy: another
    // tab or an earlier rotation may already have advanced it.
    const current = loadTokens();
    if (!current?.refresh) return null;
    try {
      const r = await fetch('/api/whoop-refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: current.refresh }),
      });
      const j = await r.json();
      if (!j.access_token) return null;
      const next: WhoopTokens = {
        access: j.access_token,
        refresh: j.refresh_token || current.refresh,
        expires: Date.now() + (j.expires_in || 3500) * 1000,
      };
      saveTokens(next);
      return next;
    } catch {
      return null;
    }
  })();

  // Clear the latch once settled so the next expiry can rotate again.
  return refreshInFlight.finally(() => {
    refreshInFlight = null;
  });
}

/** Fetch a WHOOP path through the same-origin proxy, refreshing on expiry/401. */
export async function whoopFetch<T = Record<string, unknown>>(path: string): Promise<T> {
  let t = loadTokens();
  if (!t?.access) throw new Error('WHOOP not connected');

  // Proactively rotate if we're within a minute of expiry.
  if (t.expires && Date.now() > t.expires - 60000) {
    t = (await refreshTokens()) ?? t;
  }

  const call = async (tok: WhoopTokens): Promise<Response> => {
    const [p, qs] = path.split('?');
    const params = new URLSearchParams(qs || '');
    params.set('path', p);
    return fetch(`/api/whoop-data?${params.toString()}`, {
      headers: { Authorization: `Bearer ${tok.access}`, Accept: 'application/json' },
    });
  };

  let r = await call(t);
  if (r.status === 401) {
    const n = await refreshTokens();
    if (!n) throw new Error('unauthorized — reconnect');
    r = await call(n);
  }
  if (!r.ok) throw new Error(`WHOOP ${r.status}: ${await r.text()}`);
  return r.json() as Promise<T>;
}

// ---- energy expenditure -----------------------------------------------------

export const KJ_PER_KCAL = 4.184;

export function kjToKcal(kj: number): number {
  return kj / KJ_PER_KCAL;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

export type WhoopEnergy = {
  /** Total burn so far in the current cycle (resting + activity), kcal. */
  totalKcal: number;
  /** Burn from logged workouts inside this cycle, kcal. */
  workoutKcal: number;
  /** totalKcal − workoutKcal, clamped at 0. */
  restingKcal: number;
  /** Cycle strain, if scored. */
  strain: number | null;
  /** Cycle start ISO timestamp. */
  cycleStart: string | null;
  /** WHOOP cycles stay open until the next sleep is processed; while open the
   *  totals are still accumulating, so the target derived from them is an
   *  estimate rather than a final number. */
  cycleClosed: boolean;
  /** Number of workouts counted toward workoutKcal. */
  workoutCount: number;
};

/** A cycle is safe to store as a finished day only when WHOOP has closed AND
 *  scored it. The in-progress cycle always has `end: null`, so this is what
 *  keeps a still-accumulating partial day out of the burn history — averaging
 *  one would drag the personalized floor down every time it ran. */
function isClosedCycle(c: any): boolean {
  return !!c?.end && c?.score_state === 'SCORED' && c?.score?.kilojoule != null;
}

/** Today's physiological cycle + the workouts inside it. Also harvests every
 *  closed cycle in the response into the burn history — which doubles as the
 *  backfill, since we ask for the last 25 cycles rather than just the current one.
 *
 *  Note: the proxy pins /cycle to v1 (see app/api/whoop-data/route.ts) — the
 *  `kilojoule` field is the same there as in v2. Workouts come from v2
 *  /activity/workout. Deliberately no real-time heart rate: WHOOP does not
 *  expose it, this is daily-cadence data only. */
export async function fetchWhoopEnergy(): Promise<WhoopEnergy | null> {
  const [cycleRes, workoutRes] = await Promise.all([
    whoopFetch<any>('/cycle?limit=25').catch(() => null),
    whoopFetch<any>('/activity/workout?limit=25').catch(() => null),
  ]);

  const records: any[] = Array.isArray(cycleRes?.records) ? cycleRes.records : [];

  // Record every closed cycle we can see. Cheap, idempotent (upsert by date),
  // and means the rolling average backfills instead of starting a 10-day clock.
  recordClosedCycles(records);

  // WHOOP returns cycles newest-first; the newest is today's, open or not.
  const cycle = records[0];
  if (!cycle?.score || cycle.score.kilojoule == null) return null;

  const totalKcal = kjToKcal(Number(cycle.score.kilojoule));
  const cycleStart: string | null = cycle.start ?? null;
  const cycleClosed = isClosedCycle(cycle);

  // Only count workouts that began inside the current cycle window.
  const startMs = cycleStart ? Date.parse(cycleStart) : NaN;
  const endMs = cycle.end ? Date.parse(cycle.end) : Date.now();
  const workouts: any[] = Array.isArray(workoutRes?.records) ? workoutRes.records : [];
  const inCycle = workouts.filter((w) => {
    if (w?.score?.kilojoule == null || !w.start) return false;
    const ws = Date.parse(w.start);
    if (Number.isNaN(ws)) return false;
    return (Number.isNaN(startMs) || ws >= startMs) && ws <= endMs;
  });

  const workoutKcal = inCycle.reduce((sum, w) => sum + kjToKcal(Number(w.score.kilojoule)), 0);

  return {
    totalKcal,
    workoutKcal,
    restingKcal: Math.max(0, totalKcal - workoutKcal),
    strain: cycle.score.strain != null ? Number(cycle.score.strain) : null,
    cycleStart,
    cycleClosed,
    workoutCount: inCycle.length,
  };
}

// ---- daily burn history -----------------------------------------------------
// One row per CLOSED day: { date, finalBurnKcal }. The personalized floor is a
// plain query over the most recent rows, so it self-updates as days close — no
// rebuild step, and the window keeps moving rather than freezing on the first 10.

export const WHOOP_BURN_KEY = 'whoop_burn_v1';

/** Cap stored rows. The floor only reads the last 10; the rest is headroom for
 *  later charting without unbounded localStorage growth. */
const BURN_HISTORY_CAP = 90;

export type BurnDay = {
  /** Local date of the cycle's START (the day you woke into), yyyy-mm-dd. */
  date: string;
  finalBurnKcal: number;
};

/** Stored rows, oldest → newest. */
export function loadBurnHistory(): BurnDay[] {
  const rows = storeGet<BurnDay[]>(WHOOP_BURN_KEY);
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((r) => r && typeof r.date === 'string' && typeof r.finalBurnKcal === 'number')
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** The most recent `n` closed daily burns, newest first. */
export function recentClosedBurns(n = 10): number[] {
  return loadBurnHistory()
    .slice(-n)
    .reverse()
    .map((r) => r.finalBurnKcal);
}

/** Upsert closed cycles into the burn store. Ignores open/unscored cycles. */
export function recordClosedCycles(cycles: any[]): void {
  const byDate = new Map(loadBurnHistory().map((r) => [r.date, r]));
  let changed = false;

  for (const c of cycles) {
    if (!isClosedCycle(c) || !c.start) continue;
    const ms = Date.parse(c.start);
    if (Number.isNaN(ms)) continue;
    const date = dateToKey(new Date(ms));
    const finalBurnKcal = Math.round(kjToKcal(Number(c.score.kilojoule)));

    const existing = byDate.get(date);
    if (!existing || existing.finalBurnKcal !== finalBurnKcal) {
      byDate.set(date, { date, finalBurnKcal });
      changed = true;
    }
  }

  if (!changed) return;
  const next = Array.from(byDate.values())
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-BURN_HISTORY_CAP);
  storeSet(WHOOP_BURN_KEY, next);
}

// ---- shared energy cache ----------------------------------------------------
// Both the Nutrition panel and the collapsed dashboard card need today's burn.
// Rather than each mounting its own fetch, the result lands in localStorage and
// both read it reactively through useStorageTick — the same pattern the rest of
// the app uses. Not added to any cloud-sync channel: this is derived, per-device,
// per-day data with no reason to travel.

export const WHOOP_ENERGY_KEY = 'whoop_energy_v1';

/** Refetch if the cached reading is older than this — the cycle accumulates
 *  through the day, so a stale number under-reports. */
const ENERGY_TTL_MS = 10 * 60 * 1000;

export type CachedEnergy = WhoopEnergy & { fetchedAt: number };

export function loadCachedEnergy(): CachedEnergy | null {
  const c = storeGet<CachedEnergy>(WHOOP_ENERGY_KEY);
  if (!c || typeof c.totalKcal !== 'number') return null;
  return c;
}

function isFresh(c: CachedEnergy | null): boolean {
  return !!c && Date.now() - c.fetchedAt < ENERGY_TTL_MS;
}

let energyInFlight: Promise<CachedEnergy | null> | null = null;

/** Fetch today's burn and cache it. Concurrent callers share one request. */
export function refreshWhoopEnergy(): Promise<CachedEnergy | null> {
  if (energyInFlight) return energyInFlight;

  energyInFlight = (async () => {
    if (!isConnected()) return null;
    const e = await fetchWhoopEnergy();
    if (!e) return null;
    const cached: CachedEnergy = { ...e, fetchedAt: Date.now() };
    storeSet(WHOOP_ENERGY_KEY, cached);
    return cached;
  })();

  return energyInFlight.finally(() => {
    energyInFlight = null;
  });
}

export type WhoopEnergyState = {
  energy: CachedEnergy | null;
  /** Most recent closed daily burns, newest first — feeds the personalized floor. */
  closedBurns: number[];
  connected: boolean;
  loading: boolean;
  error: string | null;
  refresh: () => void;
};

// ---- workouts for gym cardio/class auto-populate ----------------------------
// The Gym panel wants to auto-fill cardio/class plan days (runs, sprints,
// Hyrox, Pilates) from WHOOP instead of manual re-entry. Honesty over
// cleverness here: WHOOP's exact sport-name vocabulary isn't something this
// app can verify from the client, so `sportName` is passed through as-is (or
// null) and matching against a plan activity label is a best-effort
// *suggestion* the UI presents for confirmation — never a silent auto-log.

export type WhoopWorkout = {
  id: string;
  /** Raw sport_name from WHOOP if the API returned one, else null. */
  sportName: string | null;
  /** Raw sport_id if that's what the API returned instead. */
  sportId: number | null;
  start: string;
  end: string | null;
  durationMin: number | null;
  distanceKm: number | null;
  strain: number | null;
};

/** Today's WHOOP workouts (local calendar day), newest first. */
export async function fetchTodayWhoopWorkouts(): Promise<WhoopWorkout[]> {
  const res = await whoopFetch<any>('/activity/workout?limit=10').catch(() => null);
  const records: any[] = Array.isArray(res?.records) ? res.records : [];
  const todayKey = dateToKey(new Date());

  return records
    .filter((w) => w?.start && dateToKey(new Date(w.start)) === todayKey)
    .map((w): WhoopWorkout => {
      const durationMin =
        w.end && w.start ? Math.round((Date.parse(w.end) - Date.parse(w.start)) / 60000) : null;
      const distanceMeter = w.score?.distance_meter ?? w.score?.distanceMeter ?? null;
      return {
        id: String(w.id),
        sportName: typeof w.sport_name === 'string' ? w.sport_name : null,
        sportId: typeof w.sport_id === 'number' ? w.sport_id : null,
        start: w.start,
        end: w.end ?? null,
        durationMin,
        distanceKm: typeof distanceMeter === 'number' ? distanceMeter / 1000 : null,
        strain: w.score?.strain != null ? Number(w.score.strain) : null,
      };
    })
    .sort((a, b) => Date.parse(b.start) - Date.parse(a.start));
}

/** Loose keyword hints for suggesting which WHOOP workout matches a plan
 *  activity label — a starting guess for the UI to preselect, not a claim
 *  about WHOOP's actual enum. The user always confirms before it's logged. */
const ACTIVITY_HINTS: Record<string, string[]> = {
  run: ['run', 'jog'],
  sprints: ['sprint', 'hiit', 'interval'],
  pilates: ['pilates'],
  hyrox: ['hyrox', 'functional', 'crossfit'],
};

/** Best-guess WHOOP workout for a plan activity label, or null if nothing in
 *  `workouts` looks like a match. Purely a UI default — always surfaced for
 *  confirmation, never attached automatically. */
export function suggestWorkoutMatch(workouts: WhoopWorkout[], activityLabel: string): WhoopWorkout | null {
  const label = activityLabel.trim().toLowerCase();
  const hints = ACTIVITY_HINTS[label] || [label];
  return (
    workouts.find((w) => {
      const name = w.sportName?.toLowerCase() || '';
      return hints.some((h) => name.includes(h));
    }) || null
  );
}

/* eslint-enable @typescript-eslint/no-explicit-any */

/** Live view of today's WHOOP burn, refetched when the cache goes stale. */
export function useWhoopEnergy(): WhoopEnergyState {
  const tick = useStorageTick();
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const connected = React.useMemo(() => isConnected(), [tick]);
  const energy = React.useMemo(() => loadCachedEnergy(), [tick]);
  const closedBurns = React.useMemo(() => recentClosedBurns(FLOOR_WINDOW), [tick]);

  const run = React.useCallback(() => {
    if (!isConnected()) return;
    setLoading(true);
    setError(null);
    refreshWhoopEnergy()
      .then((e) => {
        if (!e) setError('No WHOOP cycle data yet today.');
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  React.useEffect(() => {
    if (connected && !isFresh(loadCachedEnergy())) run();
    // Intentionally keyed on `connected` only — re-running on every cache write
    // would loop, and staleness is re-checked on mount and via `refresh`.
  }, [connected, run]);

  return { energy, closedBurns, connected, loading, error, refresh: run };
}
