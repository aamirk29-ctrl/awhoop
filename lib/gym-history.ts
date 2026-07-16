// Progressive-overload history — per-exercise session grouping, metric
// computation, and range filtering. Pure data functions; GymPanel.tsx owns
// the presentation (chart, stats row, session table).

import type { Exercise, SetLog } from './gym';
import { estimate1RM } from './gym';
import { parseDateKey } from './dates';

export type ExerciseSession = {
  dateKey: string; // yyyy-mm-dd
  sets: SetLog[];
};

/** Groups raw logs into one session per calendar day, ascending by date. A
 *  "session" is every set logged for this exercise on that day — matches how
 *  "Today's workout" already groups sets, so 3 separate "Log set" presses on
 *  one date read as one session with 3 set chips, not 3 sessions. */
export function groupIntoSessions(logs: SetLog[]): ExerciseSession[] {
  const byDay = new Map<string, SetLog[]>();
  for (const log of logs) {
    const dk = log.date.slice(0, 10);
    const arr = byDay.get(dk);
    if (arr) arr.push(log);
    else byDay.set(dk, [log]);
  }
  return Array.from(byDay.entries())
    .map(([dateKey, sets]) => ({ dateKey, sets }))
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey));
}

/** The set within a session that maximizes e1RM — moves when EITHER weight
 *  or reps improve, per Epley. Used for weighted (and bodyweight+added). */
export function topSet(sets: SetLog[]): SetLog | null {
  if (!sets.length) return null;
  let best = sets[0];
  let bestE1rm = estimate1RM(best.weight || 0, best.reps || 0);
  for (const s of sets.slice(1)) {
    const e = estimate1RM(s.weight || 0, s.reps || 0);
    if (e > bestE1rm) {
      best = s;
      bestE1rm = e;
    }
  }
  return best;
}

/** e1RM is a rough estimate that gets unreliable at high reps — the Epley
 *  formula was validated on low-rep sets. Flag rather than hide so the chart
 *  stays honest without silently dropping data. */
export const HIGH_REP_THRESHOLD = 12;

export type HistoryMetric = 'e1rm' | 'weight' | 'volume' | 'reps' | 'pace' | 'distance';

export const WEIGHTED_METRICS: { id: HistoryMetric; label: string }[] = [
  { id: 'e1rm', label: 'Est. 1RM' },
  { id: 'weight', label: 'Weight' },
  { id: 'volume', label: 'Volume' },
];

export const BODYWEIGHT_METRICS: { id: HistoryMetric; label: string }[] = [
  { id: 'reps', label: 'Total reps' },
  { id: 'e1rm', label: 'Est. 1RM (+ added)' },
];

export const CARDIO_METRICS: { id: HistoryMetric; label: string }[] = [
  { id: 'pace', label: 'Pace' },
  { id: 'distance', label: 'Distance' },
];

export function metricsForType(type: Exercise['type']): { id: HistoryMetric; label: string }[] {
  if (type === 'weighted') return WEIGHTED_METRICS;
  if (type === 'bodyweight') return BODYWEIGHT_METRICS;
  if (type === 'cardio') return CARDIO_METRICS;
  return [];
}

export function defaultMetric(type: Exercise['type']): HistoryMetric {
  if (type === 'bodyweight') return 'reps';
  if (type === 'cardio') return 'pace';
  return 'e1rm';
}

/** Nearest logged bodyweight to a given date (prefers on-or-before, falls
 *  back to the nearest entry after if the history starts later). Structural
 *  typing — accepts anything shaped like the app's WtEntry[]. */
export function nearestBodyweight(
  entries: { dateKey: string; weight: number }[],
  dateKey: string,
): number | null {
  if (!entries.length) return null;
  let before: { dateKey: string; weight: number } | null = null;
  let after: { dateKey: string; weight: number } | null = null;
  for (const e of entries) {
    if (e.dateKey <= dateKey && (!before || e.dateKey > before.dateKey)) before = e;
    if (e.dateKey >= dateKey && (!after || e.dateKey < after.dateKey)) after = e;
  }
  return (before || after)?.weight ?? null;
}

export type SessionPoint = {
  dateKey: string;
  value: number | null;
  /** e1RM computed from a set with reps above HIGH_REP_THRESHOLD — the
   *  formula is unreliable there; the UI should de-emphasize, not hide. */
  unreliable: boolean;
  sets: SetLog[];
};

/** Computes one chart point per session for the given metric. Structural
 *  bodyweight lookup so this stays independent of the UI's WtEntry type. */
export function computeSessionPoints(
  type: Exercise['type'],
  sessions: ExerciseSession[],
  metric: HistoryMetric,
  bodyweightEntries: { dateKey: string; weight: number }[],
): SessionPoint[] {
  return sessions.map(({ dateKey, sets }) => {
    if (type === 'weighted') {
      const top = topSet(sets);
      if (!top) return { dateKey, value: null, unreliable: false, sets };
      const reps = top.reps || 0;
      if (metric === 'weight') return { dateKey, value: top.weight ?? 0, unreliable: false, sets };
      if (metric === 'volume') {
        const vol = sets.reduce((s, l) => s + (l.weight || 0) * (l.reps || 0), 0);
        return { dateKey, value: vol, unreliable: false, sets };
      }
      return { dateKey, value: estimate1RM(top.weight || 0, reps), unreliable: reps > HIGH_REP_THRESHOLD, sets };
    }
    if (type === 'bodyweight') {
      if (metric === 'reps') {
        const total = sets.reduce((s, l) => s + (l.reps || 0), 0);
        return { dateKey, value: total, unreliable: false, sets };
      }
      // e1rm: only meaningful on sets that logged added weight
      const withAdded = sets.filter((s) => (s.weight || 0) > 0);
      if (!withAdded.length) return { dateKey, value: null, unreliable: false, sets };
      const bw = nearestBodyweight(bodyweightEntries, dateKey);
      if (bw == null) return { dateKey, value: null, unreliable: false, sets };
      const top = topSet(withAdded);
      if (!top) return { dateKey, value: null, unreliable: false, sets };
      const reps = top.reps || 0;
      return { dateKey, value: estimate1RM(bw + (top.weight || 0), reps), unreliable: reps > HIGH_REP_THRESHOLD, sets };
    }
    if (type === 'cardio') {
      const km = sets.reduce((s, l) => s + (l.distanceKm || 0), 0);
      const min = sets.reduce((s, l) => s + (l.durationMin || 0), 0);
      if (metric === 'distance') return { dateKey, value: km > 0 ? km : null, unreliable: false, sets };
      return { dateKey, value: km > 0 && min > 0 ? min / km : null, unreliable: false, sets };
    }
    return { dateKey, value: null, unreliable: false, sets };
  });
}

export type RangeKey = 'W' | 'M' | '3M' | '6M' | 'Y' | 'ALL';

export const RANGE_OPTIONS: { id: RangeKey; label: string; days: number | null }[] = [
  { id: 'W', label: 'W', days: 7 },
  { id: 'M', label: 'M', days: 30 },
  { id: '3M', label: '3M', days: 90 },
  { id: '6M', label: '6M', days: 182 },
  { id: 'Y', label: 'Y', days: 365 },
  { id: 'ALL', label: 'ALL', days: null },
];

export function filterByRange(sessions: ExerciseSession[], range: RangeKey): ExerciseSession[] {
  const opt = RANGE_OPTIONS.find((r) => r.id === range);
  if (!opt || opt.days == null) return sessions;
  const cutoff = Date.now() - opt.days * 86400000;
  return sessions.filter((s) => parseDateKey(s.dateKey).getTime() >= cutoff);
}

/** All-time delta: latest non-null point minus earliest non-null point,
 *  always computed over the FULL series regardless of the range toggle —
 *  it's a fixed "since you started" reference, not a range-scoped stat. */
export function allTimeDelta(points: SessionPoint[]): number | null {
  const withVal = points.filter((p) => p.value != null);
  if (withVal.length < 2) return null;
  return (withVal[withVal.length - 1].value as number) - (withVal[0].value as number);
}

/** Delta between the most recent point and the most recent point at least
 *  30 days older — a fixed window independent of the range toggle. */
export function last30DaysDelta(points: SessionPoint[]): number | null {
  const withVal = points.filter((p) => p.value != null);
  if (withVal.length < 2) return null;
  const latest = withVal[withVal.length - 1];
  const cutoff = parseDateKey(latest.dateKey).getTime() - 30 * 86400000;
  const baseline = withVal.find((p) => parseDateKey(p.dateKey).getTime() <= cutoff) ?? withVal[0];
  if (baseline === latest) return null;
  return (latest.value as number) - (baseline.value as number);
}

/** Best value across ALL sessions on the current metric — a lifetime PR,
 *  not scoped to the visible range toggle. For pace, lower is better. */
export function bestValue(points: SessionPoint[], metric: HistoryMetric): number | null {
  const vals = points.map((p) => p.value).filter((v): v is number => v != null);
  if (!vals.length) return null;
  return metric === 'pace' ? Math.min(...vals) : Math.max(...vals);
}

/** Progress vs. the immediately preceding session, computed over the FULL
 *  (unfiltered) series so a range-filtered table still reads correctly
 *  against real history rather than treating its first visible row as new. */
export function progressDeltas(points: SessionPoint[]): (number | null)[] {
  return points.map((p, i) => {
    if (p.value == null) return null;
    for (let j = i - 1; j >= 0; j--) {
      if (points[j].value != null) return p.value - (points[j].value as number);
    }
    return null;
  });
}

/** Consecutive-session streak tolerant of weekly cadence — a gap under
 *  `graceDays` still counts as "kept it up" regardless of which weekday the
 *  class actually falls on. */
export function attendanceStreak(sessions: ExerciseSession[], graceDays = 9): number {
  if (!sessions.length) return 0;
  const dates = sessions.map((s) => parseDateKey(s.dateKey).getTime()).sort((a, b) => b - a);
  let streak = 1;
  for (let i = 1; i < dates.length; i++) {
    const gapDays = (dates[i - 1] - dates[i]) / 86400000;
    if (gapDays <= graceDays) streak++;
    else break;
  }
  return streak;
}
