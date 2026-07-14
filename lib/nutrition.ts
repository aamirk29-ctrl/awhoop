// Nutrition targets — user stats + Mifflin-St Jeor baseline calorie/protein
// math. The calorie target is split into `computeBaselineTDEE` (the
// Mifflin-St Jeor fallback) and `computeCalorieTarget`, which accepts an
// optional TDEE override — so a later phase can swap in real WHOOP burn
// data without touching the deficit/target math.

import { storeGet } from './storage';

export type Sex = 'm' | 'f';

export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'very_active' | 'extra_active';

export const ACTIVITY_FACTORS: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  very_active: 1.725,
  extra_active: 1.9,
};

export const ACTIVITY_LABELS: Record<ActivityLevel, string> = {
  sedentary: 'Sedentary (little/no exercise)',
  light: 'Light (1-3 days/week)',
  moderate: 'Moderate (3-5 days/week)',
  very_active: 'Very active (6-7 days/week)',
  extra_active: 'Extra active (physical job + training)',
};

export type UserStats = {
  weightKg: number;
  heightCm: number;
  age: number;
  sex: Sex;
  activityLevel: ActivityLevel;
  /** yyyy-mm-dd, empty string if unset */
  targetDate: string;
};

export type NutritionSettings = {
  /** % below TDEE for the recomp target, editable, default 12 */
  deficitPct: number;
  /** g protein per kg bodyweight, editable, default 2.0 */
  proteinPerKg: number;
};

export type NutritionState = {
  stats: UserStats;
  settings: NutritionSettings;
};

export const NUTRITION_KEY = 'nutrition_v1';

export function defaultUserStats(): UserStats {
  return { weightKg: 75, heightCm: 178, age: 25, sex: 'm', activityLevel: 'moderate', targetDate: '' };
}

export function defaultNutritionSettings(): NutritionSettings {
  return { deficitPct: 12, proteinPerKg: 2.0 };
}

export function defaultNutritionState(): NutritionState {
  return { stats: defaultUserStats(), settings: defaultNutritionSettings() };
}

export function normalizeNutritionState(s: Partial<NutritionState> | null | undefined): NutritionState {
  const d = defaultNutritionState();
  const x = (s || {}) as Partial<NutritionState>;
  return {
    stats: { ...d.stats, ...(x.stats || {}) },
    settings: { ...d.settings, ...(x.settings || {}) },
  };
}

export function loadNutritionState(): NutritionState {
  return normalizeNutritionState(storeGet<NutritionState>(NUTRITION_KEY));
}

// ---- calorie / protein math -------------------------------------------------

export function computeBMR(stats: UserStats): number {
  const base = 10 * stats.weightKg + 6.25 * stats.heightCm - 5 * stats.age;
  return stats.sex === 'm' ? base + 5 : base - 161;
}

/** Mifflin-St Jeor BMR × activity factor — the fallback TDEE estimate. */
export function computeBaselineTDEE(stats: UserStats): number {
  return computeBMR(stats) * ACTIVITY_FACTORS[stats.activityLevel];
}

export type CalorieCalc = {
  bmr: number;
  tdee: number;
  tdeeSource: 'mifflin-fallback' | 'override';
  deficitPct: number;
  deficitKcal: number;
  calorieTarget: number;
};

/** Recomp calorie target = TDEE − configured deficit %. Pass `tdeeOverride`
 *  to substitute a real (e.g. WHOOP-derived) TDEE for the Mifflin-St Jeor
 *  fallback without changing the deficit math below. */
export function computeCalorieTarget(state: NutritionState, tdeeOverride?: number): CalorieCalc {
  const bmr = computeBMR(state.stats);
  const tdee = tdeeOverride ?? computeBaselineTDEE(state.stats);
  const deficitPct = state.settings.deficitPct;
  const deficitKcal = tdee * (deficitPct / 100);
  return {
    bmr,
    tdee,
    tdeeSource: tdeeOverride != null ? 'override' : 'mifflin-fallback',
    deficitPct,
    deficitKcal,
    calorieTarget: tdee - deficitKcal,
  };
}

export function computeProteinTarget(state: NutritionState): number {
  return state.stats.weightKg * state.settings.proteinPerKg;
}

// ---- personalized floor -----------------------------------------------------

/** Closed days needed before the rolling average replaces the Mifflin estimate. */
export const FLOOR_MIN_DAYS = 10;
/** Size of the moving window — always the most recent N closed days, never a
 *  frozen first-N snapshot, so the floor keeps tracking weight/activity drift. */
export const FLOOR_WINDOW = 10;

export type FloorSource = 'mifflin' | 'rolling';

export type PersonalizedFloor = {
  kcal: number;
  source: FloorSource;
  /** Closed days actually available (may exceed the window). */
  daysAvailable: number;
  /** Days still needed before the rolling average takes over; 0 once active. */
  daysUntilRolling: number;
};

/** The floor the daily target can never fall below.
 *
 *  Under FLOOR_MIN_DAYS of closed history there isn't enough signal to trust an
 *  average, so we stay on the Mifflin-St Jeor TDEE. At or above it, the rolling
 *  mean of the most recent FLOOR_WINDOW closed burns takes over — a real
 *  measurement of this body rather than a population formula.
 *
 *  `closedBurns` must contain ONLY closed-cycle days (newest first); a partial
 *  day in here would silently drag the floor down. */
export function computePersonalizedFloor(
  state: NutritionState,
  closedBurns: number[],
): PersonalizedFloor {
  const days = closedBurns.length;

  if (days < FLOOR_MIN_DAYS) {
    return {
      kcal: computeBaselineTDEE(state.stats),
      source: 'mifflin',
      daysAvailable: days,
      daysUntilRolling: FLOOR_MIN_DAYS - days,
    };
  }

  const window = closedBurns.slice(0, FLOOR_WINDOW);
  const mean = window.reduce((s, v) => s + v, 0) / window.length;
  return { kcal: mean, source: 'rolling', daysAvailable: days, daysUntilRolling: 0 };
}

// ---- resolving the live target ----------------------------------------------

/** Just the shape this module needs from a WHOOP reading — kept structural so
 *  nutrition math has no dependency on the WHOOP layer. */
export type EnergyReading = {
  totalKcal: number;
  workoutKcal: number;
  restingKcal: number;
  cycleClosed: boolean;
};

export type ResolvedTargets = {
  /** The target to actually show. */
  calorie: CalorieCalc;
  /** Mifflin-St Jeor result, always computed — kept visible as a reference. */
  baseline: CalorieCalc;
  floor: PersonalizedFloor;
  /** Today's WHOOP burn so far, if we have it. */
  liveBurnKcal: number | null;
  /** True when today's burn has exceeded the floor and is driving the target up. */
  whoopRaising: boolean;
  /** True while today's cycle is still open — the target can still climb. */
  estimated: boolean;
  proteinTarget: number;
};

/** dailyTarget = max(todaysLiveBurn, personalizedFloor) × (1 − deficit).
 *
 *  The max() is the point: from wake-up the target already sits at a sensible
 *  full-day number, and WHOOP can only ever RAISE it on a high-burn day. A
 *  partial morning cycle (a few hundred kcal) loses to the floor and is simply
 *  ignored, instead of producing a nonsensical ~500 kcal target. */
export function resolveTargets(
  state: NutritionState,
  energy: EnergyReading | null,
  closedBurns: number[] = [],
): ResolvedTargets {
  const baseline = computeCalorieTarget(state);
  const proteinTarget = computeProteinTarget(state);
  const floor = computePersonalizedFloor(state, closedBurns);

  const liveBurnKcal = energy ? energy.totalKcal : null;
  const effectiveTdee = Math.max(liveBurnKcal ?? 0, floor.kcal);

  return {
    calorie: computeCalorieTarget(state, effectiveTdee),
    baseline,
    floor,
    liveBurnKcal,
    whoopRaising: liveBurnKcal != null && liveBurnKcal > floor.kcal,
    estimated: !!energy && !energy.cycleClosed,
    proteinTarget,
  };
}
