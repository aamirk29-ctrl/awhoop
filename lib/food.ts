// Food log — one entry per thing eaten, grouped by day.
//
// Days use activeDateKey() (the app's 6 AM rollover), NOT the calendar date, so
// a late-night meal counts toward the day you're still awake in. That matches
// how the WHOOP cycle driving the calorie target models a "day" (wake → sleep),
// which keeps consumed and target on the same clock.

import { storeGet, storeSet } from './storage';
import { activeDateKey } from './dates';

export const FOOD_LOG_KEY = 'food_log_v1';

/** Keep the store bounded; the UI only ever reads recent days. */
const RETAIN_DAYS = 90;

export type FoodSource = 'usda' | 'manual';

export type FoodEntry = {
  id: string;
  /** ms epoch — when it was logged. */
  ts: number;
  name: string;
  /** e.g. "150 g", "1 cup", "1 serving" — what the numbers below describe. */
  servingLabel: string;
  kcal: number;
  protein: number;
  carbs?: number;
  fat?: number;
  source: FoodSource;
  fdcId?: number;
};

/** All days: { 'yyyy-mm-dd': FoodEntry[] }. */
export type FoodLog = Record<string, FoodEntry[]>;

export function loadFoodLog(): FoodLog {
  const raw = storeGet<FoodLog>(FOOD_LOG_KEY);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: FoodLog = {};
  for (const [day, entries] of Object.entries(raw)) {
    if (Array.isArray(entries)) out[day] = entries.filter((e) => e && typeof e.kcal === 'number');
  }
  return out;
}

function saveFoodLog(log: FoodLog) {
  const days = Object.keys(log).sort();
  const trimmed: FoodLog = {};
  for (const d of days.slice(-RETAIN_DAYS)) {
    if (log[d].length > 0) trimmed[d] = log[d];
  }
  storeSet(FOOD_LOG_KEY, trimmed);
}

export function entriesFor(log: FoodLog, day: string = activeDateKey()): FoodEntry[] {
  return (log[day] || []).slice().sort((a, b) => a.ts - b.ts);
}

export function addEntry(entry: Omit<FoodEntry, 'id' | 'ts'> & { ts?: number }, day: string = activeDateKey()) {
  const log = loadFoodLog();
  const full: FoodEntry = {
    ...entry,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ts: entry.ts ?? Date.now(),
  };
  saveFoodLog({ ...log, [day]: [...(log[day] || []), full] });
}

export function updateEntry(id: string, patch: Partial<FoodEntry>, day: string = activeDateKey()) {
  const log = loadFoodLog();
  const entries = log[day] || [];
  saveFoodLog({
    ...log,
    [day]: entries.map((e) => (e.id === id ? { ...e, ...patch, id: e.id } : e)),
  });
}

export function removeEntry(id: string, day: string = activeDateKey()) {
  const log = loadFoodLog();
  const entries = log[day] || [];
  saveFoodLog({ ...log, [day]: entries.filter((e) => e.id !== id) });
}

// ---- totals -----------------------------------------------------------------

export type Consumed = { kcal: number; protein: number; carbs: number; fat: number; count: number };

export function totalsFor(entries: FoodEntry[]): Consumed {
  return entries.reduce<Consumed>(
    (t, e) => ({
      kcal: t.kcal + (e.kcal || 0),
      protein: t.protein + (e.protein || 0),
      carbs: t.carbs + (e.carbs || 0),
      fat: t.fat + (e.fat || 0),
      count: t.count + 1,
    }),
    { kcal: 0, protein: 0, carbs: 0, fat: 0, count: 0 },
  );
}

/** Consumed vs target, with remaining clamped at 0 for display. */
export type Progress = {
  consumed: number;
  target: number;
  remaining: number;
  pct: number;
  over: boolean;
};

export function progress(consumed: number, target: number): Progress {
  const remaining = target - consumed;
  return {
    consumed,
    target,
    remaining: Math.max(0, remaining),
    pct: target > 0 ? Math.min(100, (consumed / target) * 100) : 0,
    over: remaining < 0,
  };
}
