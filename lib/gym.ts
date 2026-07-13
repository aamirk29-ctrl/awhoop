// Progressive-overload coach model — same shapes and localStorage keys as
// the old gym.html (`po_coach_v1`, `po_coach_workout_done`,
// `po_coach_weights`, `po_coach_photos`).

import { storeGet } from './storage';

export const PO_KEY = 'po_coach_v1';
export const WORKOUT_DONE_KEY = 'po_coach_workout_done';
export const WT_KEY = 'po_coach_weights';
export const PHOTO_KEY = 'po_coach_photos';

export const GYM_CONFIG = {
  units: 'kg' as const,
  gyms: [
    { id: 'home', name: 'Home Gym' },
    { id: 'comm', name: 'Commercial Gym' },
  ],
  days: [
    { id: 'push', name: 'Push' },
    { id: 'pull', name: 'Pull' },
    { id: 'legs', name: 'Legs' },
  ],
  splitRotation: ['push', 'pull', 'legs', 'rest'],
  splitAnchor: { date: '2026-05-12', splitId: 'rest' },
  upgradeAtReps: 8,
  composition: { enabled: true, yearsTraining: 1, windowDays: 30 },
  defaultExercises: [
    { name: 'Bench press', gym: 'comm', day: 'push', repMin: 5, repMax: 8, step: 2.5, startWeight: 60 },
    { name: 'Overhead press', gym: 'comm', day: 'push', repMin: 5, repMax: 8, step: 2.5, startWeight: 35 },
    { name: 'Tricep pushdown', gym: 'comm', day: 'push', repMin: 8, repMax: 12, step: 2.5, startWeight: 25 },
    { name: 'Pull-ups', gym: 'both', day: 'pull', repMin: 5, repMax: 10, step: 1, startWeight: 0, bw: true },
    { name: 'Barbell row', gym: 'comm', day: 'pull', repMin: 6, repMax: 10, step: 2.5, startWeight: 50 },
    { name: 'Bicep curl', gym: 'comm', day: 'pull', repMin: 8, repMax: 12, step: 1.25, startWeight: 15 },
    { name: 'Back squat', gym: 'comm', day: 'legs', repMin: 5, repMax: 8, step: 5, startWeight: 80 },
    { name: 'Romanian deadlift', gym: 'comm', day: 'legs', repMin: 6, repMax: 10, step: 5, startWeight: 60 },
    { name: 'Leg press', gym: 'comm', day: 'legs', repMin: 8, repMax: 12, step: 5, startWeight: 100 },
  ],
};

export type Exercise = {
  id: string;
  name: string;
  gym: string;
  day: string;
  repMin: number;
  repMax: number;
  step: number;
  startWeight: number;
  bw?: boolean;
};

export type SetLog = { weight: number; reps: number; date: string };

export type PoState = {
  units: 'kg' | 'lb';
  gyms: { id: string; name: string }[];
  days: { id: string; name: string }[];
  exercises: Exercise[];
  logs: Record<string, SetLog[]>;
  filterGym: string;
  filterDay: string;
  currentEx?: string | null;
  splitRotation: string[];
  splitAnchor: { date: string; index: number };
  _userPickedDay?: boolean;
};

function buildDefaultExercises(): Exercise[] {
  return GYM_CONFIG.defaultExercises.map((e, i) => ({ id: `seed_${i}_${Date.now()}`, ...e }));
}

export function normalizePoState(raw: Partial<PoState> | null | undefined): PoState {
  const s = (raw || {}) as Partial<PoState>;
  const gyms = Array.isArray(s.gyms) && s.gyms.length ? s.gyms : GYM_CONFIG.gyms.slice();
  const days = Array.isArray(s.days) && s.days.length ? s.days : GYM_CONFIG.days.slice();
  let splitRotation = s.splitRotation;
  if (!Array.isArray(splitRotation) || !splitRotation.length) {
    splitRotation = GYM_CONFIG.splitRotation.map((x) => {
      const d = GYM_CONFIG.days.find((dd) => dd.id === x);
      return d ? d.name : x === 'rest' ? 'Rest' : x.charAt(0).toUpperCase() + x.slice(1);
    });
  }
  let splitAnchor = s.splitAnchor;
  if (!splitAnchor || !splitAnchor.date || splitAnchor.index == null) {
    const oldId = GYM_CONFIG.splitAnchor.splitId;
    let idx = 0;
    if (oldId) {
      const oldDay = GYM_CONFIG.days.find((d) => d.id === oldId);
      const targetName = oldDay ? oldDay.name : oldId === 'rest' ? 'Rest' : oldId;
      const found = splitRotation.findIndex((n) => n.toLowerCase() === targetName.toLowerCase());
      if (found >= 0) idx = found;
    }
    splitAnchor = { date: GYM_CONFIG.splitAnchor.date || new Date().toISOString().slice(0, 10), index: idx };
  }
  return {
    units: s.units || GYM_CONFIG.units,
    gyms,
    days,
    exercises: Array.isArray(s.exercises) ? (s.exercises as Exercise[]) : buildDefaultExercises(),
    logs: s.logs && typeof s.logs === 'object' ? s.logs : {},
    filterGym: s.filterGym || gyms[0].id,
    filterDay: s.filterDay || days[0].id,
    currentEx: s.currentEx || null,
    splitRotation,
    splitAnchor,
    _userPickedDay: s._userPickedDay,
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
