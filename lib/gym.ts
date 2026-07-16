// Progressive-overload coach model — same shapes and localStorage keys as
// the old gym.html (`po_coach_v1`, `po_coach_workout_done`,
// `po_coach_weights`, `po_coach_photos`), extended with a real exercise
// database, a weekly training split, and staleness-ranked per-day
// recommendations.

import { storeGet } from './storage';
import {
  EQUIPMENT_VOCAB,
  MUSCLE_GROUP_MAP,
  type DbExercise,
  type ExerciseType,
  type MuscleGroupKey,
  equipmentAvailable,
  primaryMusclesMatch,
} from './exercise-db';
import { rankByStaleness } from './staleness';

export const PO_KEY = 'po_coach_v1';
export const WORKOUT_DONE_KEY = 'po_coach_workout_done';
export const WT_KEY = 'po_coach_weights';
export const PHOTO_KEY = 'po_coach_photos';

export type PlanActivity = { type: 'cardio' | 'class'; label: string };

export type DayConfig = {
  id: string;
  name: string;
  /** Muscle groups this day's lifting recommendations should target. */
  muscleGroups: MuscleGroupKey[];
  /** Non-lifting blocks for the day (runs, sprints, classes) — auto-populated
   *  from WHOOP where possible, see lib/whoop.ts. */
  activities: PlanActivity[];
  /** Exercise names always anchored to this day, shown in the plan editor.
   *  Informational — the actual loggable entries live in `exercises` below,
   *  same as any other exercise. */
  pinned: string[];
  /** When true, recommendations for this day ignore muscleGroups and pull
   *  from the whole bodyweight pool instead (e.g. a general calisthenics
   *  day with no specific target). */
  openBodyweight?: boolean;
};

export const GYM_CONFIG = {
  units: 'kg' as const,
  gyms: [
    { id: 'home', name: 'Home Gym' },
    { id: 'comm', name: 'Commercial Gym' },
  ],
  days: [
    { id: 'mon', name: 'Monday', muscleGroups: ['back', 'biceps'], activities: [], pinned: ['Pull-ups', 'Low rows'] },
    {
      id: 'tue',
      name: 'Tuesday',
      muscleGroups: ['chest', 'triceps', 'shoulders'],
      activities: [{ type: 'cardio', label: 'Sprints' }],
      pinned: [],
    },
    {
      id: 'wed',
      name: 'Wednesday',
      muscleGroups: ['legs'],
      activities: [{ type: 'class', label: 'Pilates' }],
      pinned: [],
    },
    {
      id: 'thu',
      name: 'Thursday',
      muscleGroups: [],
      activities: [{ type: 'cardio', label: 'Run' }],
      pinned: [],
      openBodyweight: true,
    },
    { id: 'fri', name: 'Friday', muscleGroups: ['back', 'chest'], activities: [], pinned: [] },
    { id: 'sat', name: 'Saturday', muscleGroups: [], activities: [{ type: 'class', label: 'Hyrox' }], pinned: [] },
    {
      id: 'sun',
      name: 'Sunday',
      muscleGroups: ['core'],
      activities: [{ type: 'cardio', label: 'Run' }],
      pinned: [],
    },
  ] as DayConfig[],
  // 7 entries in Mon->Sun order, anchored to a real Monday — todaySplit()'s
  // date-diff-modulo-length math then reproduces true day-of-week forever,
  // no separate "day of week" concept needed.
  splitRotation: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
  splitAnchor: { date: '2026-07-13', splitId: 'mon' },
  upgradeAtReps: 8,
  composition: { enabled: true, yearsTraining: 1, windowDays: 30 },
  defaultExercises: [
    // Monday's fixed anchors — everything else is populated from
    // recommendations rather than hardcoded starter data.
    { name: 'Pull-ups', gym: 'both', day: 'mon', type: 'bodyweight', repMin: 5, repMax: 10, step: 1, startWeight: 0 },
    { name: 'Low rows', gym: 'comm', day: 'mon', type: 'weighted', repMin: 6, repMax: 10, step: 2.5, startWeight: 40 },
    // One loggable row per plan activity (cardio/class) so each shows up in
    // the exercise picker on its day, same as any other exercise.
    { name: 'Sprints', gym: 'both', day: 'tue', type: 'cardio' },
    { name: 'Pilates', gym: 'both', day: 'wed', type: 'class' },
    { name: 'Run', gym: 'both', day: 'thu', type: 'cardio' },
    { name: 'Hyrox', gym: 'both', day: 'sat', type: 'class' },
    { name: 'Run', gym: 'both', day: 'sun', type: 'cardio' },
  ] as Array<Omit<Exercise, 'id'>>,
};

export type Exercise = {
  id: string;
  name: string;
  gym: string;
  day: string;
  type: ExerciseType;
  /** Links back to a free-exercise-db record — set when the exercise was
   *  added via search/recommendations. Legacy/manual entries lack this and
   *  fall back to normalized-name matching for staleness lookups. */
  dbId?: string;
  // weighted / bodyweight only
  repMin?: number;
  repMax?: number;
  step?: number;
  startWeight?: number;
  /** @deprecated use `type === 'bodyweight'`. Kept only so already-stored
   *  logs from before the type system don't need a data migration pass. */
  bw?: boolean;
};

export type SetLog = {
  date: string;
  /** weighted: load lifted. bodyweight: optional added load, default 0. */
  weight?: number;
  /** weighted / bodyweight: reps performed. */
  reps?: number;
  /** cardio only. */
  distanceKm?: number;
  durationMin?: number;
  /** class only: true once logged (attendance is binary). */
  attended?: boolean;
  /** cardio / class: how the entry got here. */
  source?: 'manual' | 'whoop';
  /** cardio / class: WHOOP workout id, used to avoid double-importing the
   *  same session. */
  whoopWorkoutId?: string;
};

export type PoState = {
  units: 'kg' | 'lb';
  gyms: { id: string; name: string }[];
  days: DayConfig[];
  exercises: Exercise[];
  logs: Record<string, SetLog[]>;
  filterGym: string;
  filterDay: string;
  currentEx?: string | null;
  splitRotation: string[];
  splitAnchor: { date: string; index: number };
  _userPickedDay?: boolean;
  /** Equipment you actually have access to — filters recommendations.
   *  Bodyweight exercises always pass regardless of this list. */
  availableEquipment: string[];
};

function buildDefaultExercises(): Exercise[] {
  return GYM_CONFIG.defaultExercises.map((e, i) => ({ id: `seed_${i}_${Date.now()}`, ...e }));
}

function normalizeDayConfig(raw: unknown): DayConfig | null {
  const d = raw as Partial<DayConfig> & { id?: string; name?: string };
  if (!d || typeof d.id !== 'string' || typeof d.name !== 'string') return null;
  return {
    id: d.id,
    name: d.name,
    muscleGroups: Array.isArray(d.muscleGroups) ? (d.muscleGroups as MuscleGroupKey[]) : [],
    activities: Array.isArray(d.activities) ? (d.activities as PlanActivity[]) : [],
    pinned: Array.isArray(d.pinned) ? (d.pinned as string[]) : [],
    openBodyweight: !!d.openBodyweight,
  };
}

function normalizeExercise(raw: unknown): Exercise | null {
  const e = raw as Partial<Exercise> & { id?: string; name?: string };
  if (!e || typeof e.id !== 'string' || typeof e.name !== 'string') return null;
  const type: ExerciseType = e.type || (e.bw ? 'bodyweight' : 'weighted');
  return {
    id: e.id,
    name: e.name,
    gym: e.gym || 'both',
    day: e.day || '',
    type,
    dbId: e.dbId,
    repMin: e.repMin,
    repMax: e.repMax,
    step: e.step,
    startWeight: e.startWeight,
    bw: type === 'bodyweight',
  };
}

export function normalizePoState(raw: Partial<PoState> | null | undefined): PoState {
  const s = (raw || {}) as Partial<PoState>;
  const gyms = Array.isArray(s.gyms) && s.gyms.length ? s.gyms : GYM_CONFIG.gyms.slice();
  const days = Array.isArray(s.days) && s.days.length
    ? (s.days.map(normalizeDayConfig).filter(Boolean) as DayConfig[])
    : GYM_CONFIG.days.slice();
  let splitRotation = s.splitRotation;
  if (!Array.isArray(splitRotation) || !splitRotation.length) {
    splitRotation = GYM_CONFIG.splitRotation.slice();
  }
  let splitAnchor = s.splitAnchor;
  if (!splitAnchor || !splitAnchor.date || splitAnchor.index == null) {
    const oldId = GYM_CONFIG.splitAnchor.splitId;
    let idx = 0;
    if (oldId) {
      const oldDay = GYM_CONFIG.days.find((d) => d.id === oldId);
      const targetName = oldDay ? oldDay.name : oldId;
      const found = splitRotation.findIndex((n) => n.toLowerCase() === targetName.toLowerCase());
      if (found >= 0) idx = found;
    }
    splitAnchor = { date: GYM_CONFIG.splitAnchor.date || new Date().toISOString().slice(0, 10), index: idx };
  }
  const exercises = Array.isArray(s.exercises)
    ? (s.exercises.map(normalizeExercise).filter(Boolean) as Exercise[])
    : buildDefaultExercises();
  const availableEquipment = Array.isArray(s.availableEquipment) ? s.availableEquipment : EQUIPMENT_VOCAB.slice();
  return {
    units: s.units || GYM_CONFIG.units,
    gyms,
    days,
    exercises,
    logs: s.logs && typeof s.logs === 'object' ? s.logs : {},
    filterGym: s.filterGym || gyms[0].id,
    filterDay: s.filterDay || days[0].id,
    currentEx: s.currentEx || null,
    splitRotation,
    splitAnchor,
    _userPickedDay: s._userPickedDay,
    availableEquipment,
  };
}

export function loadPoState(): PoState {
  return normalizePoState(storeGet<PoState>(PO_KEY));
}

export function estimate1RM(w: number, r: number): number {
  if (r < 2) return w;
  return w * (1 + r / 30);
}

export function roundToStep(v: number, s: number): number {
  return Math.round(v / s) * s;
}

export function todaySplit(state: PoState): { name: string; index: number } {
  try {
    const rot = state.splitRotation;
    if (!rot || !rot.length) return { name: '—', index: 0 };
    const a = new Date(state.splitAnchor.date);
    const t = new Date();
    a.setHours(0, 0, 0, 0);
    t.setHours(0, 0, 0, 0);
    const diffDays = Math.round((t.getTime() - a.getTime()) / 86400000);
    const idx = (((state.splitAnchor.index + diffDays) % rot.length) + rot.length) % rot.length;
    return { name: rot[idx], index: idx };
  } catch {
    return { name: state.splitRotation?.[0] || '—', index: 0 };
  }
}

export function isRestName(name: string | undefined): boolean {
  return /^rest\b/i.test(name || '');
}

// ---- staleness-ranked recommendations --------------------------------------

function normalizeExerciseName(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Most recent log date (ms epoch) for a DB exercise, or null if it's never
 *  been logged. Matches by dbId first, falling back to normalized-name
 *  matching so pre-existing manually-named entries still connect. */
export function lastDoneAt(state: PoState, dbEx: DbExercise): number | null {
  const nameNorm = normalizeExerciseName(dbEx.name);
  let latest: number | null = null;
  for (const ex of state.exercises) {
    const matches = ex.dbId ? ex.dbId === dbEx.id : normalizeExerciseName(ex.name) === nameNorm;
    if (!matches) continue;
    for (const log of state.logs[ex.id] || []) {
      const t = Date.parse(log.date);
      if (!Number.isNaN(t) && (latest == null || t > latest)) latest = t;
    }
  }
  return latest;
}

export type RecommendationGroup = {
  key: MuscleGroupKey | 'open';
  label: string;
  exercises: DbExercise[];
};

const RECS_PER_GROUP = 5;

/** Staleness-ranked, equipment-filtered recommendations for a plan day.
 *  `openBodyweight` days ignore muscle groups and rank the whole bodyweight
 *  pool instead — variety over precision when there's no specific target. */
export function getRecommendations(state: PoState, db: DbExercise[], day: DayConfig): RecommendationGroup[] {
  const available = new Set(state.availableEquipment);
  const alreadyOnDay = new Set(
    state.exercises.filter((ex) => ex.day === day.id).map((ex) => ex.dbId || normalizeExerciseName(ex.name)),
  );
  const notAlreadyAdded = (ex: DbExercise) => !alreadyOnDay.has(ex.id) && !alreadyOnDay.has(normalizeExerciseName(ex.name));
  const pool = db.filter((ex) => equipmentAvailable(ex, available) && notAlreadyAdded(ex));

  if (day.openBodyweight) {
    const bodyweightPool = pool.filter((ex) => ex.equipment === 'body only' || ex.equipment == null);
    const ranked = rankByStaleness(bodyweightPool, (ex) => lastDoneAt(state, ex));
    return [{ key: 'open', label: 'Calisthenics', exercises: ranked.slice(0, RECS_PER_GROUP) }];
  }

  return day.muscleGroups.map((group) => {
    const muscles = MUSCLE_GROUP_MAP[group];
    const matching = pool.filter((ex) => primaryMusclesMatch(ex, muscles));
    const ranked = rankByStaleness(matching, (ex) => lastDoneAt(state, ex));
    return { key: group, label: group, exercises: ranked.slice(0, RECS_PER_GROUP) };
  });
}
