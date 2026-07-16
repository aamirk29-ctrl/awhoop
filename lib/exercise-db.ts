// Bundled exercise database — vendored from yuhonas/free-exercise-db
// (public domain, https://github.com/yuhonas/free-exercise-db) at
// public/exercises.json. This data never changes, so it ships as a
// same-origin static asset and is fetched once at runtime and cached in
// memory — no GitHub calls, no API key, no rate limits, works offline after
// first load. Images are NOT bundled (they'd be heavy for 800+ exercises);
// `exerciseImageUrl()` builds a lazy-load URL straight to GitHub's raw host
// for on-demand display only.

export type ExerciseType = 'weighted' | 'bodyweight' | 'cardio' | 'class';

/** Raw shape of a public/exercises.json record. force/mechanic/equipment are
 *  null in some upstream records — every reader here must be null-safe. */
export type DbExercise = {
  id: string;
  name: string;
  force: string | null;
  level: string;
  mechanic: string | null;
  equipment: string | null;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  instructions: string[];
  category: string;
};

/** Builds the lazy-load image URL for a DB exercise. Not bundled — fetched
 *  on demand straight from the source repo when a detail view is opened. */
export function exerciseImageUrl(id: string, index = 0): string {
  return `https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/${encodeURIComponent(id)}/${index}.jpg`;
}

// ---- type derivation ---------------------------------------------------
// 'class' is never derived — nothing in this DB models attendance-only
// sessions (Pilates, Hyrox). Those only exist as plan-level entries you
// define yourself in lib/gym.ts.

/** Best-effort type guess for a DB record. Null-safe: equipment is null for
 *  ~9% of records (mostly stretching/plyometrics), which we also treat as
 *  bodyweight since no equipment is listed. `equipment: 'other'` (ab
 *  rollers, battling ropes, strongman implements, some plyometric drills)
 *  defaults to weighted since it's not literally bodyweight — expect to
 *  override some of these per exercise. */
export function deriveExerciseType(ex: Pick<DbExercise, 'category' | 'equipment'>): Exclude<ExerciseType, 'class'> {
  if (ex.category === 'cardio') return 'cardio';
  if (ex.equipment === 'body only' || ex.equipment == null) return 'bodyweight';
  return 'weighted';
}

// ---- muscle group vocabulary --------------------------------------------
// Maps the app's coarse split muscle groups onto free-exercise-db's
// primaryMuscles vocabulary (confirmed against the actual dataset).

export type MuscleGroupKey = 'back' | 'biceps' | 'chest' | 'triceps' | 'shoulders' | 'legs' | 'core';

export const MUSCLE_GROUP_MAP: Record<MuscleGroupKey, string[]> = {
  back: ['lats', 'middle back', 'lower back', 'traps'],
  biceps: ['biceps'],
  chest: ['chest'],
  triceps: ['triceps'],
  shoulders: ['shoulders'],
  legs: ['quadriceps', 'hamstrings', 'glutes', 'calves'],
  core: ['abdominals'],
};

export const MUSCLE_GROUP_LABELS: Record<MuscleGroupKey, string> = {
  back: 'Back',
  biceps: 'Biceps',
  chest: 'Chest',
  triceps: 'Triceps',
  shoulders: 'Shoulders',
  legs: 'Legs',
  core: 'Core',
};

/** Equipment vocabulary present in the dataset, for the availability
 *  checklist in Settings. 'body only' is deliberately excluded — bodyweight
 *  exercises always pass the equipment filter regardless of what's checked. */
export const EQUIPMENT_VOCAB = [
  'barbell',
  'dumbbell',
  'machine',
  'cable',
  'kettlebells',
  'bands',
  'medicine ball',
  'exercise ball',
  'foam roll',
  'e-z curl bar',
  'other',
] as const;

export type EquipmentKey = (typeof EQUIPMENT_VOCAB)[number];

export const EQUIPMENT_LABELS: Record<EquipmentKey, string> = {
  barbell: 'Barbell',
  dumbbell: 'Dumbbell',
  machine: 'Machine',
  cable: 'Cable',
  kettlebells: 'Kettlebells',
  bands: 'Bands',
  'medicine ball': 'Medicine ball',
  'exercise ball': 'Exercise ball',
  'foam roll': 'Foam roll',
  'e-z curl bar': 'E-Z curl bar',
  other: 'Other / misc',
};

/** Null-safe: an exercise with no equipment listed (body only or null)
 *  always passes, regardless of what's available. */
export function equipmentAvailable(ex: Pick<DbExercise, 'equipment'>, available: ReadonlySet<string>): boolean {
  if (ex.equipment == null || ex.equipment === 'body only') return true;
  return available.has(ex.equipment);
}

export function primaryMusclesMatch(ex: Pick<DbExercise, 'primaryMuscles'>, muscles: readonly string[]): boolean {
  const set = new Set(muscles);
  return (ex.primaryMuscles || []).some((m) => set.has(m));
}

// ---- loading (fetch-once, cached) ---------------------------------------

let dbPromise: Promise<DbExercise[]> | null = null;

/** Loads public/exercises.json once and caches it in memory for the life of
 *  the page. Same-origin static asset — no network dependency beyond the
 *  app's own bundle. */
export function loadExerciseDb(): Promise<DbExercise[]> {
  if (dbPromise) return dbPromise;
  dbPromise = fetch('/exercises.json')
    .then((r) => {
      if (!r.ok) throw new Error(`exercises.json ${r.status}`);
      return r.json();
    })
    .then((data) => (Array.isArray(data) ? (data as DbExercise[]) : []))
    .catch((e) => {
      dbPromise = null; // allow retry on next call
      throw e;
    });
  return dbPromise;
}

// ---- fuzzy search ---------------------------------------------------------
// Small dependency-free scorer: normalizes gym-speak abbreviations, then
// scores by token containment/prefix so "incline db press" matches
// "Incline Dumbbell Press" without needing the exact record name.

const ABBREVIATIONS: Record<string, string> = {
  db: 'dumbbell',
  dbs: 'dumbbell',
  bb: 'barbell',
  kb: 'kettlebell',
  kbs: 'kettlebell',
  ohp: 'overhead press',
  bp: 'bench press',
  rdl: 'romanian deadlift',
  dl: 'deadlift',
  bw: 'bodyweight',
  pu: 'pull up',
  cgbp: 'close grip bench press',
};

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((tok) => ABBREVIATIONS[tok] || tok)
    .join(' ');
}

function tokenScore(queryTokens: string[], nameNorm: string, nameTokens: string[]): number {
  let score = 0;
  for (const qt of queryTokens) {
    let best = 0;
    for (const nt of nameTokens) {
      if (nt === qt) best = Math.max(best, qt.length * 3);
      else if (nt.startsWith(qt)) best = Math.max(best, qt.length * 2);
      else if (nt.includes(qt)) best = Math.max(best, qt.length);
    }
    if (best === 0 && nameNorm.includes(qt)) best = qt.length * 0.5;
    if (best === 0) return 0; // every query token must match something
    score += best;
  }
  return score;
}

export type SearchOptions = {
  primaryMuscles?: readonly string[];
  equipment?: ReadonlySet<string>; // available equipment; omit to skip the filter
  level?: string;
  limit?: number;
};

/** Fuzzy name search over the DB, with optional post-filters. Query tokens
 *  are order-independent and abbreviation-aware; every token must match
 *  something in the name for a result to qualify. Empty query returns all
 *  records (post-filters still apply) so this doubles as a plain filter. */
export function searchExercises(db: DbExercise[], query: string, opts: SearchOptions = {}): DbExercise[] {
  const qNorm = normalize(query.trim());
  const qTokens = qNorm ? qNorm.split(' ') : [];

  let results = db;
  if (opts.primaryMuscles?.length) {
    results = results.filter((ex) => primaryMusclesMatch(ex, opts.primaryMuscles!));
  }
  if (opts.equipment) {
    results = results.filter((ex) => equipmentAvailable(ex, opts.equipment!));
  }
  if (opts.level) {
    results = results.filter((ex) => ex.level === opts.level);
  }

  if (!qTokens.length) {
    return opts.limit ? results.slice(0, opts.limit) : results;
  }

  const scored = results
    .map((ex) => {
      const nameNorm = normalize(ex.name);
      const nameTokens = nameNorm.split(' ');
      return { ex, score: tokenScore(qTokens, nameNorm, nameTokens) };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((r) => r.ex);

  return opts.limit ? scored.slice(0, opts.limit) : scored;
}
