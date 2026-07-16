'use client';

// Gym panel — port of gym.html: weight tracker + composition estimate,
// progress photos, and the progressive-overload coach (filters, prescription
// engine, stats, trend, history, today's/past workouts, rotation editor,
// settings). Same localStorage keys, so logs and sync carry over.

import * as React from 'react';
import { Pencil, Plus, Search, Settings2, X } from 'lucide-react';
import type { BentoAccent } from '@/components/ui/aurora-bento-grid';
import { storeGet, storeSet, storeRemove, useStorageTick } from '@/lib/storage';
import { dateToKey, parseDateKey } from '@/lib/dates';
import {
  GYM_CONFIG,
  PO_KEY,
  WORKOUT_DONE_KEY,
  WT_KEY,
  estimate1RM,
  getRecommendations,
  isRestName,
  loadPoState,
  normalizePoState,
  roundToStep,
  todaySplit,
  type DayConfig,
  type Exercise,
  type PlanActivity,
  type PoState,
  type RecommendationGroup,
  type SetLog,
} from '@/lib/gym';
import {
  EQUIPMENT_LABELS,
  EQUIPMENT_VOCAB,
  MUSCLE_GROUP_LABELS,
  MUSCLE_GROUP_MAP,
  deriveExerciseType,
  exerciseImageUrl,
  loadExerciseDb,
  searchExercises,
  type DbExercise,
  type ExerciseType,
  type MuscleGroupKey,
} from '@/lib/exercise-db';
import {
  fetchTodayWhoopWorkouts,
  isConnected as isWhoopConnected,
  suggestWorkoutMatch,
  type WhoopWorkout,
} from '@/lib/whoop';
import { ProgressPhotos } from './gym-photos';
import {
  Card,
  DangerGhostButton,
  EmptyState,
  Eyebrow,
  GhostButton,
  Modal,
  PrimaryButton,
  SectionTitle,
  Seg,
  SelectInput,
  TextInput,
} from './shared';

type WtEntry = { dateKey: string; weight: number };

function wtLoad(): WtEntry[] {
  const arr = storeGet<WtEntry[]>(WT_KEY) || [];
  return Array.isArray(arr) ? arr.slice().sort((a, b) => a.dateKey.localeCompare(b.dateKey)) : [];
}

const DOWS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MONS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** Builds a loggable Exercise from a DB record, with sensible starter
 *  rep/weight defaults per type. Shared by the recommendations quick-add and
 *  the database search modal so both add exercises the same way. */
function buildExerciseFromDb(rec: DbExercise, gym: string, day: string): Exercise {
  const type = deriveExerciseType(rec);
  const defaults =
    type === 'weighted'
      ? { repMin: 6, repMax: 10, step: 2.5, startWeight: 20 }
      : type === 'bodyweight'
        ? { repMin: 5, repMax: 10, step: 1, startWeight: 0 }
        : {};
  return {
    id: `ex_${Date.now()}_${Math.floor(Math.random() * 9999)}`,
    name: rec.name,
    gym,
    day,
    type,
    dbId: rec.id,
    ...defaults,
  };
}

export default function GymPanel({ accent }: { accent: BentoAccent }) {
  const tick = useStorageTick();
  const state = React.useMemo(() => loadPoState(), [tick]);
  const wtEntries = React.useMemo(() => wtLoad(), [tick]);
  const doneDays = storeGet<Record<string, string>>(WORKOUT_DONE_KEY) || {};

  const [rotOpen, setRotOpen] = React.useState(false);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [exModal, setExModal] = React.useState<{ mode: 'add' | 'edit'; ex?: Exercise } | null>(null);
  const [dbModalOpen, setDbModalOpen] = React.useState(false);
  const [db, setDb] = React.useState<DbExercise[]>([]);
  const [dbError, setDbError] = React.useState<string | null>(null);

  const mutate = (patch: Partial<PoState>) => storeSet(PO_KEY, { ...state, ...patch });

  // Load the vendored exercise database once — same-origin static asset, no
  // GitHub call, cached in lib/exercise-db.ts across mounts.
  React.useEffect(() => {
    loadExerciseDb()
      .then(setDb)
      .catch((e) => setDbError(e instanceof Error ? e.message : String(e)));
  }, []);

  // Auto-snap the day filter to today's split once (unless the user picked one)
  React.useEffect(() => {
    const s = loadPoState();
    const split = todaySplit(s);
    if (!split.name || isRestName(split.name) || s._userPickedDay) return;
    const match = s.days.find((d) => d.name.toLowerCase() === split.name.toLowerCase());
    if (match && s.filterDay !== match.id) storeSet(PO_KEY, { ...s, filterDay: match.id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const split = todaySplit(state);
  const d = new Date();

  return (
    <div className="flex flex-col gap-4 pb-2 pt-2">
      {/* day pill */}
      <button
        type="button"
        onClick={() => setRotOpen(true)}
        title="Tap to edit the split rotation"
        className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-full border border-white/[0.07] bg-white/[0.04] px-3 py-1.5 font-mono text-[11px] font-bold uppercase tracking-[0.1em] text-ink-2 transition-colors hover:border-white/[0.14] hover:text-ink"
      >
        <span>{`${DOWS[d.getDay()]}, ${MONS[d.getMonth()]} ${d.getDate()}`}</span>
        <span className="text-ink-4">·</span>
        <span className={isRestName(split.name) ? 'text-sky-300' : ''} style={!isRestName(split.name) ? { color: accent.text } : undefined}>
          {isRestName(split.name) ? 'REST DAY' : `${split.name} DAY`.toUpperCase()}
        </span>
      </button>

      {/* ===== weight tracker ===== */}
      <SectionTitle>Weight</SectionTitle>
      <WeightCard state={state} entries={wtEntries} accent={accent} />
      <ProgressPhotos units={state.units} accent={accent.from} />

      {/* ===== coach ===== */}
      <SectionTitle
        right={
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            aria-label="Settings"
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-[9px] border border-white/[0.07] bg-white/[0.04] text-ink-2 transition-colors hover:text-ink"
          >
            <Settings2 size={14} aria-hidden />
          </button>
        }
      >
        Progressive overload coach
      </SectionTitle>
      <CoachCard
        state={state}
        accent={accent}
        doneDays={doneDays}
        mutate={mutate}
        db={db}
        onAddExercise={() => setExModal({ mode: 'add' })}
        onEditExercise={(ex) => setExModal({ mode: 'edit', ex })}
        onOpenDb={() => setDbModalOpen(true)}
      />

      {/* modals */}
      {rotOpen && <RotationModal state={state} onClose={() => setRotOpen(false)} />}
      {settingsOpen && <SettingsModal state={state} onClose={() => setSettingsOpen(false)} />}
      {exModal && (
        <ExerciseModal
          state={state}
          mode={exModal.mode}
          exercise={exModal.ex}
          onClose={() => setExModal(null)}
        />
      )}
      {dbModalOpen && (
        <ExerciseDbModal
          db={db}
          dbError={dbError}
          state={state}
          onAdd={(rec) => {
            const ex = buildExerciseFromDb(rec, state.filterGym, state.filterDay);
            mutate({ exercises: [...state.exercises, ex], currentEx: ex.id });
            setDbModalOpen(false);
          }}
          onClose={() => setDbModalOpen(false)}
        />
      )}
    </div>
  );
}

// ============================== WEIGHT ======================================
function WeightCard({
  state,
  entries,
  accent,
}: {
  state: PoState;
  entries: WtEntry[];
  accent: BentoAccent;
}) {
  const u = state.units;
  const todayKey = dateToKey(new Date());
  const todayEntry = entries.find((e) => e.dateKey === todayKey);
  const last = entries[entries.length - 1] || null;
  const [editing, setEditing] = React.useState(false);
  const [input, setInput] = React.useState('');

  const saveEntry = (weight: number) => {
    const arr = wtLoad();
    const existing = arr.find((e) => e.dateKey === todayKey);
    if (existing) existing.weight = weight;
    else arr.push({ dateKey: todayKey, weight });
    arr.sort((a, b) => a.dateKey.localeCompare(b.dateKey));
    storeSet(WT_KEY, arr);
    setEditing(false);
    setInput('');
  };

  // streak
  let streak = 0;
  {
    const cursor = new Date();
    if (!entries.find((e) => e.dateKey === dateToKey(cursor))) cursor.setDate(cursor.getDate() - 1);
    while (entries.find((e) => e.dateKey === dateToKey(cursor))) {
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    }
  }

  // 7d delta
  let delta: number | null = null;
  if (entries.length >= 2 && last) {
    const lastDate = parseDateKey(last.dateKey);
    const cutoff = new Date(lastDate);
    cutoff.setDate(cutoff.getDate() - 7);
    const baseline = entries.find((e) => parseDateKey(e.dateKey) >= cutoff) || entries[0];
    const diff = last.weight - baseline.weight;
    if (Math.abs(diff) >= 0.05) delta = diff;
  }

  const comp = React.useMemo(() => computeComposition(state, entries), [state, entries]);

  return (
    <Card className="border border-white/0" >
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-[44px] font-semibold leading-none tracking-tight text-ink tabular-nums">
          {last ? last.weight.toFixed(1) : '—'}
        </span>
        <span className="text-[16px] text-ink-3">{u}</span>
      </div>
      {delta != null && (
        <div className={`mt-1.5 text-[13px] font-medium tabular-nums ${delta > 0 ? 'text-warn' : 'text-good'}`}>
          {delta > 0 ? '↑ +' : '↓ −'}
          {Math.abs(delta).toFixed(1)} {u} · last 7d
        </div>
      )}
      {streak >= 2 && (
        <div className="mt-1.5 inline-flex items-center gap-1.5 text-[13px] font-medium text-good">
          🔥 {streak} day streak
        </div>
      )}

      {entries.length === 0 && (
        <div className="mb-1 mt-3 rounded-xl border border-dashed border-white/[0.07] px-4 py-7 text-center text-[13px] text-ink-3">
          Log your first weight to start tracking.
        </div>
      )}

      {entries.length >= 2 && <WeightChart entries={entries} accent={accent.from} />}

      {comp && (
        <div className="mt-4 rounded-xl border border-white/[0.07] bg-white/[0.025] px-4 py-3.5">
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-ink-3">
              Composition estimate
            </span>
            <span className="font-mono text-[10px] text-ink-4">last {comp.actualDays}d</span>
          </div>
          <div
            className={`mb-2.5 text-[14.5px] font-semibold leading-snug ${
              comp.cls === 'good' ? 'text-good' : comp.cls === 'warn' ? 'text-warn' : comp.cls === 'bad' ? 'text-bad' : 'text-ink'
            }`}
          >
            {comp.headline}
          </div>
          <div className="mb-2 flex h-2.5 overflow-hidden rounded-[5px] bg-white/[0.04]">
            <div className="h-full bg-good transition-all" style={{ width: `${comp.musclePct}%` }} />
            <div className="h-full bg-warn transition-all" style={{ width: `${comp.fatPct}%` }} />
          </div>
          <div className="text-[11.5px] leading-normal tabular-nums text-ink-2">{comp.foot}</div>
        </div>
      )}

      {todayEntry && !editing ? (
        <div className="mt-3.5 flex items-center justify-between rounded-xl border border-good/[0.16] bg-good/[0.04] px-3.5 py-3">
          <div className="flex items-center gap-3">
            <span className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-good/[0.12] font-bold text-good">
              ✓
            </span>
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-3">LOGGED TODAY</div>
              <div className="text-[15px] font-semibold text-ink">
                {todayEntry.weight.toFixed(1)} {u}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setEditing(true);
              setInput(todayEntry.weight.toFixed(1));
            }}
            className="cursor-pointer px-2.5 py-1.5 text-[13px] font-semibold text-good"
          >
            Edit
          </button>
        </div>
      ) : (
        <div className="mt-3.5 grid grid-cols-[1fr_auto_auto] items-center gap-2.5">
          <TextInput
            type="number"
            step="0.1"
            inputMode="decimal"
            placeholder="Enter weight"
            aria-label="Today's weight"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const v = parseFloat(input);
                if (!isNaN(v) && v > 0) saveEntry(v);
              }
            }}
          />
          <span className="text-[13px] text-ink-3">{u}</span>
          <button
            type="button"
            onClick={() => {
              const v = parseFloat(input);
              if (!isNaN(v) && v > 0) saveEntry(v);
            }}
            className="cursor-pointer rounded-[10px] px-4 py-2.5 text-[13px] font-bold text-black"
            style={{ background: accent.from }}
          >
            Save
          </button>
        </div>
      )}
    </Card>
  );
}

function wtSmoothPath(points: { x: number; y: number }[]): string {
  if (!points.length) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  let d = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const cx = (prev.x + curr.x) / 2;
    d += ` Q ${cx.toFixed(2)} ${prev.y.toFixed(2)}, ${cx.toFixed(2)} ${((prev.y + curr.y) / 2).toFixed(2)}`;
    d += ` T ${curr.x.toFixed(2)} ${curr.y.toFixed(2)}`;
  }
  return d;
}

function WeightChart({ entries, accent }: { entries: WtEntry[]; accent: string }) {
  const recent = entries.slice(-30);
  const weights = recent.map((e) => e.weight);
  const min = Math.min(...weights);
  const max = Math.max(...weights);
  const pad = Math.max((max - min) * 0.15, 0.5);
  const yMin = min - pad;
  const yMax = max + pad;
  const xLeft = 8, xRight = 312, yTop = 20, yBot = 110;
  const xFor = (i: number) => (recent.length === 1 ? xRight : xLeft + (i / (recent.length - 1)) * (xRight - xLeft));
  const yFor = (w: number) => yBot - ((w - yMin) / (yMax - yMin)) * (yBot - yTop);
  const points = recent.map((e, i) => ({ x: xFor(i), y: yFor(e.weight) }));
  const linePath = wtSmoothPath(points);
  const areaPath = `${linePath} L ${points[points.length - 1].x.toFixed(2)} ${yBot} L ${points[0].x.toFixed(2)} ${yBot} Z`;
  const avgPoints = recent.map((_, i) => {
    const win = recent.slice(Math.max(0, i - 6), i + 1);
    const avg = win.reduce((s, p) => s + p.weight, 0) / win.length;
    return { x: xFor(i), y: yFor(avg) };
  });

  return (
    <div className="mt-4">
      <div className="relative">
        <div className="absolute bottom-0 left-0 top-0 flex w-9 flex-col justify-between py-1">
          <span className="font-mono text-[10px] text-ink-4">{yMax.toFixed(1)}</span>
          <span className="font-mono text-[10px] text-ink-4">{yMin.toFixed(1)}</span>
        </div>
        <svg viewBox="0 0 320 130" preserveAspectRatio="none" className="ml-9 block h-[130px] w-[calc(100%-2.25rem)]" aria-hidden>
          <defs>
            <linearGradient id="wtFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={accent} stopOpacity="0.25" />
              <stop offset="100%" stopColor={accent} stopOpacity="0" />
            </linearGradient>
          </defs>
          {[20, 65, 110].map((y) => (
            <line key={y} x1="0" y1={y} x2="320" y2={y} stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
          ))}
          <path d={wtSmoothPath(avgPoints)} fill="none" stroke={`${accent}73`} strokeWidth="1.5" strokeDasharray="4 3" opacity="0.6" />
          <path d={areaPath} fill="url(#wtFill)" />
          <path d={linePath} fill="none" stroke={accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          {points.map((p, i) => (
            <circle
              key={i}
              cx={p.x}
              cy={p.y}
              r={i === points.length - 1 ? 5 : 3}
              fill={i === points.length - 1 ? '#fff' : accent}
              stroke={i === points.length - 1 ? accent : '#111113'}
              strokeWidth={i === points.length - 1 ? 2 : 1.5}
            />
          ))}
        </svg>
      </div>
      <div className="mt-2 text-center text-[11px] text-ink-3">
        {entries.length} {entries.length === 1 ? 'entry' : 'entries'} · last {recent.length} days
      </div>
      <div className="mt-2 flex justify-center gap-4">
        <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.18em] text-ink-3">
          <span className="h-0.5 w-3.5 rounded-[1px]" style={{ background: accent }} /> DAILY
        </span>
        <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.18em] text-ink-3">
          <span className="h-0.5 w-3.5 border-t-2 border-dashed" style={{ borderColor: `${accent}73` }} /> 7-DAY AVG
        </span>
      </div>
    </div>
  );
}

// Composition estimate — weight delta + strength trend + training frequency.
function computeComposition(state: PoState, entries: WtEntry[]) {
  if (!GYM_CONFIG.composition.enabled || entries.length < 2) return null;
  const windowDays = GYM_CONFIG.composition.windowDays || 30;
  const now = parseDateKey(entries[entries.length - 1].dateKey);
  const start = new Date(now);
  start.setDate(start.getDate() - windowDays);
  const startEntry = entries.find((e) => parseDateKey(e.dateKey) >= start);
  const endEntry = entries[entries.length - 1];
  if (!startEntry || startEntry === endEntry) return null;
  const weightDelta = endEntry.weight - startEntry.weight;
  const actualDays = Math.max(
    1,
    Math.round((parseDateKey(endEntry.dateKey).getTime() - parseDateKey(startEntry.dateKey).getTime()) / 86400000),
  );
  const weeks = actualDays / 7;

  const strengthRatios: number[] = [];
  const workoutDays = new Set<string>();
  state.exercises.forEach((ex) => {
    const logs = state.logs[ex.id] || [];
    const isStrength = ex.type === 'weighted';
    if (!isStrength || logs.length < 2) {
      logs.forEach((l) => {
        if (new Date(l.date) >= start) workoutDays.add(l.date.slice(0, 10));
      });
      return;
    }
    const inWin = logs.filter((l) => new Date(l.date) >= start);
    const before = logs.filter((l) => new Date(l.date) < start);
    inWin.forEach((l) => workoutDays.add(l.date.slice(0, 10)));
    if (!inWin.length || !before.length) return;
    const avg = (arr: SetLog[]) => arr.reduce((s, l) => s + estimate1RM(l.weight || 0, l.reps || 0), 0) / arr.length;
    const a = avg(before);
    if (a <= 0) return;
    strengthRatios.push(avg(inWin) / a);
  });
  const strengthDelta = strengthRatios.length
    ? strengthRatios.reduce((s, r) => s + r, 0) / strengthRatios.length - 1
    : 0;
  const sessionsPerWeek = (workoutDays.size / actualDays) * 7;
  const frequencyFactor = Math.max(0.4, Math.min(1.2, sessionsPerWeek / 4));

  const yt = GYM_CONFIG.composition.yearsTraining || 1;
  const maxMuscleKgPerWeek = yt <= 1 ? 0.45 : yt === 2 ? 0.23 : 0.11;
  const unitConv = state.units === 'lb' ? 2.20462 : 1;
  const maxMusclePerWeek = maxMuscleKgPerWeek * unitConv;
  const strengthBoost = Math.max(0.5, Math.min(1.5, 1 + strengthDelta * 4));
  let estMuscle = maxMusclePerWeek * weeks * strengthBoost * frequencyFactor;

  let estFat: number;
  let cls = '';
  let headline = '';
  if (weightDelta > 0) {
    estMuscle = Math.min(estMuscle, weightDelta);
    estFat = Math.max(0, weightDelta - estMuscle);
    const musclePct = estMuscle / weightDelta;
    if (musclePct >= 0.6 && strengthDelta > 0) {
      cls = 'good';
      headline = `+${weightDelta.toFixed(1)} ${state.units} — mostly muscle, strength up.`;
    } else if (musclePct >= 0.35) {
      cls = 'warn';
      headline = `+${weightDelta.toFixed(1)} ${state.units} — mixed. Tighten kcal or push lifts harder.`;
    } else {
      cls = 'bad';
      headline = `+${weightDelta.toFixed(1)} ${state.units} — mostly fat. Strength flat. Cut kcal.`;
    }
  } else {
    const wDown = Math.abs(weightDelta);
    if (strengthDelta >= 0) {
      estMuscle = Math.min(maxMusclePerWeek * weeks * 0.3, 0.5);
      estFat = wDown + estMuscle;
      cls = 'good';
      headline = `−${wDown.toFixed(1)} ${state.units} — strength holding, fat dropping.`;
    } else {
      const lossPct = Math.min(0.4, Math.abs(strengthDelta) * 2);
      estMuscle = -wDown * lossPct;
      estFat = -(wDown + estMuscle);
      cls = 'warn';
      headline = `−${wDown.toFixed(1)} ${state.units} — strength slipping. You may be losing muscle.`;
    }
  }

  const totalAbs = Math.abs(estMuscle) + Math.abs(estFat) || 1;
  const sd = strengthDelta * 100;
  return {
    actualDays,
    cls,
    headline,
    musclePct: (Math.abs(estMuscle) / totalAbs) * 100,
    fatPct: (Math.abs(estFat) / totalAbs) * 100,
    foot:
      `~${estMuscle >= 0 ? '+' : ''}${estMuscle.toFixed(1)} ${state.units} muscle · ` +
      `~${estFat >= 0 ? '+' : ''}${estFat.toFixed(1)} ${state.units} fat · ` +
      `strength ${sd >= 0 ? '+' : ''}${sd.toFixed(1)}%` +
      ` · ${sessionsPerWeek.toFixed(1)} sessions/wk` +
      (strengthRatios.length ? '' : ' (no lift data)'),
  };
}

// ============================== COACH =======================================
type Rx = {
  type: 'up' | 'down' | 'hold';
  weight: number;
  reps: number;
  tag: string;
  reason: string;
  bw?: boolean;
};

function getRx(ex: Exercise, logs: SetLog[], unit: string): Rx | null {
  if (!logs.length) return null;
  const last = logs[logs.length - 1];
  const weight = last.weight ?? 0;
  const reps = last.reps ?? 0;
  const repMin = ex.repMin ?? 1;
  const repMax = ex.repMax ?? repMin;
  const step = ex.step ?? 2.5;
  const bw = ex.type === 'bodyweight';
  const upgradeAt = Math.min(GYM_CONFIG.upgradeAtReps || 8, repMax);
  let stuck = 0;
  for (let i = logs.length - 1; i >= 0; i--) {
    if ((logs[i].weight ?? 0) === weight) stuck++;
    else break;
  }
  if (bw) {
    if (reps >= upgradeAt)
      return { type: 'up', weight: 0, reps: reps + 1, tag: 'Push for more', reason: `${reps} reps — strong. Push for ${reps + 1} next time.`, bw: true };
    if (reps >= repMin)
      return { type: 'hold', weight: 0, reps: reps + 1, tag: 'Add a rep', reason: `${reps} reps. Push for ${reps + 1} next session.`, bw: true };
    return { type: 'hold', weight: 0, reps: repMin, tag: 'Repeat', reason: `${reps} reps fell short. Repeat until you hit ${repMin}+.`, bw: true };
  }
  if (stuck >= 3 && reps < repMin) {
    const dl = roundToStep(weight * 0.9, step);
    return { type: 'down', weight: dl, reps: repMax, tag: 'Deload', reason: `Stuck at ${weight}${unit} for ${stuck} sessions. Drop 10%, reset, build back cleaner.` };
  }
  if (reps >= upgradeAt)
    return { type: 'up', weight: weight + step, reps: repMin, tag: 'Add weight', reason: `You hit ${reps} reps — time to add ${step}${unit}. Expect ${repMin}-${repMin + 1} next session.` };
  if (reps >= repMin && reps < upgradeAt)
    return { type: 'hold', weight, reps: reps + 1, tag: 'Add a rep', reason: `${reps} reps in target. Stay at ${weight}${unit}, push for ${reps + 1}.` };
  return { type: 'hold', weight, reps: repMin, tag: 'Repeat', reason: `${reps} reps short of ${repMin}-${upgradeAt}. Repeat ${weight}${unit} until you hit ${repMin}+ clean.` };
}

function CoachCard({
  state,
  accent,
  doneDays,
  mutate,
  db,
  onAddExercise,
  onEditExercise,
  onOpenDb,
}: {
  state: PoState;
  accent: BentoAccent;
  doneDays: Record<string, string>;
  mutate: (patch: Partial<PoState>) => void;
  db: DbExercise[];
  onAddExercise: () => void;
  onEditExercise: (ex: Exercise) => void;
  onOpenDb: () => void;
}) {
  const unit = state.units;
  const filtered = state.exercises.filter(
    (e) => (e.gym === state.filterGym || e.gym === 'both') && e.day === state.filterDay,
  );
  const current = filtered.find((e) => e.id === state.currentEx) || filtered[0] || null;
  const logs: SetLog[] = current ? (state.logs[current.id] || []).slice() : [];
  const isWeighted = current?.type === 'weighted';
  const isBodyweight = current?.type === 'bodyweight';
  const isCardio = current?.type === 'cardio';
  const isClass = current?.type === 'class';

  const [weightInput, setWeightInput] = React.useState('');
  const [repsSel, setRepsSel] = React.useState<number | null>(null);
  const [distanceInput, setDistanceInput] = React.useState('');
  const [durationInput, setDurationInput] = React.useState('');
  const [pastOpen, setPastOpen] = React.useState(false);

  // pre-fill weight when exercise changes
  React.useEffect(() => {
    if (current && current.type === 'weighted') {
      const w = logs.length ? logs[logs.length - 1].weight ?? 0 : current.startWeight || 0;
      setWeightInput(String(w));
    } else {
      setWeightInput('');
    }
    setRepsSel(null);
    setDistanceInput('');
    setDurationInput('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  // rep pills range (weighted / bodyweight only)
  const repMin = current ? Math.max(1, current.repMin || 1) : 4;
  const repMax = current ? Math.max(repMin, current.repMax || repMin) : 12;
  const repEnd = Math.min(Math.max(repMax + 2, repMin + 5), repMin + 15);
  const activeRep = repsSel != null && repsSel >= repMin && repsSel <= repEnd ? repsSel : repMax;

  // WHOOP suggestion for the current cardio/class exercise
  const [whoopWorkouts, setWhoopWorkouts] = React.useState<WhoopWorkout[]>([]);
  React.useEffect(() => {
    setWhoopWorkouts([]);
    if (!current || (current.type !== 'cardio' && current.type !== 'class') || !isWhoopConnected()) return;
    let cancelled = false;
    fetchTodayWhoopWorkouts()
      .then((w) => {
        if (!cancelled) setWhoopWorkouts(w);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [current?.id, current?.type]);
  const whoopSuggestion = current ? suggestWorkoutMatch(whoopWorkouts, current.name) : null;

  const logSet = () => {
    if (!current) return;
    if (current.type === 'cardio') {
      const distanceKm = parseFloat(distanceInput) || 0;
      const durationMin = parseFloat(durationInput) || 0;
      if (distanceKm <= 0 && durationMin <= 0) {
        alert('Enter a distance or duration.');
        return;
      }
      const arr = (state.logs[current.id] || []).slice();
      arr.push({ date: new Date().toISOString(), distanceKm, durationMin, source: 'manual' });
      mutate({ logs: { ...state.logs, [current.id]: arr }, currentEx: current.id });
      setDistanceInput('');
      setDurationInput('');
      return;
    }
    if (current.type === 'class') {
      const arr = (state.logs[current.id] || []).slice();
      arr.push({ date: new Date().toISOString(), attended: true, source: 'manual' });
      mutate({ logs: { ...state.logs, [current.id]: arr }, currentEx: current.id });
      return;
    }
    const reps = activeRep;
    if (reps <= 0) return;
    const w = current.type === 'bodyweight' ? parseFloat(weightInput) || 0 : parseFloat(weightInput) || 0;
    if (current.type === 'weighted' && w <= 0) {
      alert('Enter a weight.');
      return;
    }
    const arr = (state.logs[current.id] || []).slice();
    arr.push({ weight: w, reps, date: new Date().toISOString() });
    mutate({ logs: { ...state.logs, [current.id]: arr }, currentEx: current.id });
  };

  const logFromWhoop = (w: WhoopWorkout) => {
    if (!current) return;
    const arr = (state.logs[current.id] || []).slice();
    if (current.type === 'cardio') {
      arr.push({
        date: w.start,
        distanceKm: w.distanceKm ?? 0,
        durationMin: w.durationMin ?? 0,
        source: 'whoop',
        whoopWorkoutId: w.id,
      });
    } else {
      arr.push({ date: w.start, attended: true, source: 'whoop', whoopWorkoutId: w.id });
    }
    mutate({ logs: { ...state.logs, [current.id]: arr }, currentEx: current.id });
  };

  const rx = current && (isWeighted || isBodyweight) ? getRx(current, logs, unit) : null;
  const lastLog = logs[logs.length - 1];

  // stats
  let oneRm = '—';
  let bestSet = '—';
  let totalDistance = 0;
  let totalDuration = 0;
  if (current && logs.length) {
    if (isCardio) {
      totalDistance = logs.reduce((s, l) => s + (l.distanceKm || 0), 0);
      totalDuration = logs.reduce((s, l) => s + (l.durationMin || 0), 0);
    } else if (isBodyweight) {
      oneRm = `${Math.max(...logs.map((l) => l.reps || 0))}`;
    } else if (isWeighted) {
      oneRm = String(Math.round(Math.max(...logs.map((l) => estimate1RM(l.weight || 0, l.reps || 0)))));
    }
    if (isWeighted || isBodyweight) {
      let best = logs[0];
      logs.forEach((l) => {
        const cur = isBodyweight ? l.reps || 0 : estimate1RM(l.weight || 0, l.reps || 0);
        const bestVal = isBodyweight ? best.reps || 0 : estimate1RM(best.weight || 0, best.reps || 0);
        if (cur > bestVal) best = l;
      });
      bestSet = isBodyweight ? `${best.reps}r` : `${best.weight}×${best.reps}`;
    }
  }

  // recommendations for the filtered day
  const dayConfig = state.days.find((d) => d.id === state.filterDay);
  const recGroups = React.useMemo(
    () => (dayConfig && db.length ? getRecommendations(state, db, dayConfig) : []),
    [state, db, dayConfig],
  );

  const quickAddFromDb = (rec: DbExercise) => {
    const ex = buildExerciseFromDb(rec, state.filterGym, state.filterDay);
    mutate({ exercises: [...state.exercises, ex], currentEx: ex.id });
  };

  // today's + past workouts
  const byDay: Record<string, { ex: Exercise; log: SetLog }[]> = {};
  state.exercises.forEach((ex) => {
    (state.logs[ex.id] || []).forEach((l) => {
      const dk = l.date.slice(0, 10);
      (byDay[dk] ||= []).push({ ex, log: l });
    });
  });
  const todayKey = dateToKey(new Date());
  const todaySets = byDay[todayKey] || [];
  const todaySum = summarizeDay(todaySets);
  const past = Object.entries(byDay)
    .filter(([dk]) => dk !== todayKey)
    .sort((a, b) => b[0].localeCompare(a[0]));
  const isDoneToday = !!doneDays[todayKey];

  const toggleDone = () => {
    const next = { ...doneDays };
    if (next[todayKey]) delete next[todayKey];
    else next[todayKey] = new Date().toISOString();
    storeSet(WORKOUT_DONE_KEY, next);
  };

  const trendVals = React.useMemo(() => {
    if (!current) return [];
    const trendLogs = logs.slice(-10);
    if (isBodyweight) return trendLogs.map((l) => l.reps || 0);
    if (isWeighted) return trendLogs.map((l) => estimate1RM(l.weight || 0, l.reps || 0));
    if (isCardio) {
      return trendLogs
        .filter((l) => (l.distanceKm || 0) > 0 && (l.durationMin || 0) > 0)
        .map((l) => (l.durationMin as number) / (l.distanceKm as number)); // min/km — lower is faster
    }
    return [];
  }, [current, logs, isBodyweight, isWeighted, isCardio]);

  return (
    <Card>
      {/* filters */}
      <div className="mb-4 flex flex-col gap-2">
        <div className="flex items-center gap-2.5">
          <span className="min-w-9 text-[10px] font-bold uppercase tracking-[0.14em] text-ink-3">Gym</span>
          <Seg
            className="flex-1"
            options={state.gyms.map((g) => ({ value: g.id, label: g.name }))}
            value={state.filterGym}
            onChange={(v) => mutate({ filterGym: v, currentEx: null })}
          />
        </div>
        <div className="flex items-center gap-2.5">
          <span className="min-w-9 text-[10px] font-bold uppercase tracking-[0.14em] text-ink-3">Day</span>
          <Seg
            className="flex-1"
            options={state.days.map((d) => ({ value: d.id, label: d.name }))}
            value={state.filterDay}
            onChange={(v) => mutate({ filterDay: v, currentEx: null, _userPickedDay: true })}
          />
        </div>
      </div>

      {/* exercise picker */}
      <SubTitle>Exercise</SubTitle>
      <div className="flex items-center gap-2">
        <SelectInput
          value={current?.id || ''}
          disabled={!filtered.length}
          onChange={(e) => mutate({ currentEx: e.target.value })}
          className="min-w-0 flex-1 text-[14px]"
        >
          {filtered.length ? (
            filtered.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
                {e.type === 'bodyweight'
                  ? ' · BW'
                  : e.type === 'cardio'
                    ? ' · Cardio'
                    : e.type === 'class'
                      ? ' · Class'
                      : e.startWeight
                        ? ` · ${e.startWeight}${unit}`
                        : ''}
                {e.gym === 'both' ? ' ★' : ''}
              </option>
            ))
          ) : (
            <option>—</option>
          )}
        </SelectInput>
        <IconBtn onClick={onOpenDb} label="Browse exercise database">
          <Search size={15} aria-hidden />
        </IconBtn>
        <IconBtn onClick={onAddExercise} label="Add exercise">
          <Plus size={17} aria-hidden />
        </IconBtn>
        <IconBtn onClick={() => current && onEditExercise(current)} label="Edit exercise" disabled={!current}>
          <Pencil size={15} aria-hidden />
        </IconBtn>
      </div>
      {!filtered.length && (
        <div className="mt-2.5 rounded-xl border border-dashed border-white/[0.07] bg-white/[0.025] p-4 text-center text-[13px] text-ink-3">
          No exercises here yet. Tap <strong>+</strong> to add one, or search the database.
        </div>
      )}

      {/* recommendations */}
      {recGroups.some((g) => g.exercises.length > 0) && (
        <>
          <SubTitle className="mt-5">Today's recommendations</SubTitle>
          <div className="flex flex-col gap-3">
            {recGroups
              .filter((g) => g.exercises.length > 0)
              .map((g) => (
                <div key={g.key}>
                  <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-ink-3">
                    {MUSCLE_GROUP_LABELS[g.key as MuscleGroupKey] || g.label}
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {g.exercises.map((rec) => (
                      <button
                        key={rec.id}
                        type="button"
                        onClick={() => quickAddFromDb(rec)}
                        className="flex cursor-pointer items-center justify-between gap-2 rounded-[10px] border border-white/[0.07] bg-white/[0.025] px-3 py-2.5 text-left text-[13px] transition-colors hover:border-white/[0.14] hover:bg-white/[0.05]"
                      >
                        <span className="min-w-0 truncate font-semibold text-ink">{rec.name}</span>
                        <span className="shrink-0 rounded-full bg-white/[0.06] px-2 py-1 text-[10px] font-bold uppercase tracking-[0.06em] text-ink-3">
                          + Add
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
          </div>
        </>
      )}

      {/* log form */}
      <SubTitle className="mt-5">Log {isCardio ? "today's session" : isClass ? 'attendance' : "today's top set"}</SubTitle>
      {isBodyweight && (
        <div className="mb-3 rounded-lg border border-white/[0.07] bg-white/[0.04] py-2 text-center text-[11px] font-bold uppercase tracking-[0.1em] text-ink-2">
          Bodyweight — reps, with optional added {unit}
        </div>
      )}

      {(isCardio || isClass) && whoopSuggestion && (
        <div className="mb-3 rounded-[10px] border border-good/[0.18] bg-good/[0.06] px-3.5 py-3 text-[12px]">
          <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-good">
            Found on WHOOP
          </div>
          <div className="mb-2 text-ink">
            {whoopSuggestion.sportName || 'Workout'}
            {whoopSuggestion.durationMin ? ` · ${whoopSuggestion.durationMin} min` : ''}
            {whoopSuggestion.distanceKm ? ` · ${whoopSuggestion.distanceKm.toFixed(1)} km` : ''}
          </div>
          <button
            type="button"
            onClick={() => logFromWhoop(whoopSuggestion)}
            className="cursor-pointer rounded-lg bg-good/[0.16] px-3 py-1.5 text-[12px] font-bold text-good"
          >
            Log from WHOOP
          </button>
        </div>
      )}
      {(isCardio || isClass) && !whoopSuggestion && whoopWorkouts.length > 0 && (
        <div className="mb-3 flex flex-col gap-1.5">
          <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-ink-3">Today's WHOOP workouts</div>
          {whoopWorkouts.map((w) => (
            <button
              key={w.id}
              type="button"
              onClick={() => logFromWhoop(w)}
              className="cursor-pointer rounded-lg border border-white/[0.07] bg-white/[0.025] px-3 py-2 text-left text-[12px] text-ink-2 hover:bg-white/[0.05]"
            >
              {w.sportName || 'Workout'}
              {w.durationMin ? ` · ${w.durationMin} min` : ''}
              {w.distanceKm ? ` · ${w.distanceKm.toFixed(1)} km` : ''} — tap to log
            </button>
          ))}
        </div>
      )}

      {current && lastLog && (isWeighted || isBodyweight) && (
        <div className="mb-3 flex items-center gap-3 rounded-[10px] border border-white/[0.07] bg-white/[0.025] px-3.5 py-2.5 text-[12px]">
          <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-ink-3">Last time</span>
          <span className="font-bold tabular-nums text-ink">
            {isBodyweight ? `${lastLog.reps} reps` : `${lastLog.weight}${unit} × ${lastLog.reps}`}
          </span>
          <span className="ml-auto font-mono text-[11px] text-ink-3">{agoLabel(lastLog.date)}</span>
        </div>
      )}

      {isClass ? (
        <PrimaryButton onClick={logSet} disabled={!current} className="w-full py-3.5">
          Mark attended
        </PrimaryButton>
      ) : isCardio ? (
        <>
          <div className="mb-3.5 grid grid-cols-2 gap-2.5">
            <div className="flex flex-col gap-2">
              <FieldLabel>Distance (km)</FieldLabel>
              <input
                type="number"
                step="0.1"
                inputMode="decimal"
                placeholder="0"
                value={distanceInput}
                onChange={(e) => setDistanceInput(e.target.value)}
                className="min-w-0 rounded-xl border border-white/[0.07] bg-black/30 px-3 py-3 text-center font-mono text-[20px] font-bold text-ink tabular-nums outline-none focus:border-white/40"
              />
            </div>
            <div className="flex flex-col gap-2">
              <FieldLabel>Duration (min)</FieldLabel>
              <input
                type="number"
                step="1"
                inputMode="decimal"
                placeholder="0"
                value={durationInput}
                onChange={(e) => setDurationInput(e.target.value)}
                className="min-w-0 rounded-xl border border-white/[0.07] bg-black/30 px-3 py-3 text-center font-mono text-[20px] font-bold text-ink tabular-nums outline-none focus:border-white/40"
              />
            </div>
          </div>
          <PrimaryButton onClick={logSet} disabled={!current} className="w-full py-3.5">
            Log session
          </PrimaryButton>
        </>
      ) : (
        <>
          <div className={`mb-3.5 grid gap-2.5 ${isBodyweight ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2'}`}>
            {!isBodyweight ? (
              <div className="flex flex-col gap-2">
                <FieldLabel>Weight ({unit})</FieldLabel>
                <div className="grid grid-cols-[auto_1fr_auto] items-stretch gap-1.5">
                  <WBtn onClick={() => setWeightInput(String(Math.max(0, (parseFloat(weightInput) || 0) - (current?.step || 2.5))))}>−</WBtn>
                  <input
                    type="number"
                    step="0.5"
                    inputMode="decimal"
                    placeholder="0"
                    value={weightInput}
                    onChange={(e) => setWeightInput(e.target.value)}
                    className="min-w-0 rounded-xl border border-white/[0.07] bg-black/30 px-3 py-3 text-center font-mono text-[22px] font-bold text-ink tabular-nums outline-none focus:border-white/40"
                  />
                  <WBtn onClick={() => setWeightInput(String((parseFloat(weightInput) || 0) + (current?.step || 2.5)))}>+</WBtn>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <FieldLabel>Added weight ({unit}, optional)</FieldLabel>
                <div className="grid grid-cols-[auto_1fr_auto] items-stretch gap-1.5">
                  <WBtn onClick={() => setWeightInput(String(Math.max(0, (parseFloat(weightInput) || 0) - (current?.step || 1))))}>−</WBtn>
                  <input
                    type="number"
                    step="0.5"
                    inputMode="decimal"
                    placeholder="0"
                    value={weightInput}
                    onChange={(e) => setWeightInput(e.target.value)}
                    className="min-w-0 rounded-xl border border-white/[0.07] bg-black/30 px-3 py-3 text-center font-mono text-[22px] font-bold text-ink tabular-nums outline-none focus:border-white/40"
                  />
                  <WBtn onClick={() => setWeightInput(String((parseFloat(weightInput) || 0) + (current?.step || 1)))}>+</WBtn>
                </div>
              </div>
            )}
            <div className="flex flex-col gap-2">
              <FieldLabel>Reps</FieldLabel>
              <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-[repeat(auto-fit,minmax(44px,1fr))]">
                {Array.from({ length: repEnd - repMin + 1 }, (_, i) => repMin + i).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRepsSel(r)}
                    className={`cursor-pointer rounded-lg border py-3 font-mono text-[13px] font-semibold tabular-nums transition-colors ${
                      r === activeRep
                        ? 'border-transparent bg-gradient-to-b from-white to-[#e8e5dd] font-extrabold text-[#0a0a0b]'
                        : 'border-white/[0.07] bg-black/30 text-ink-2 hover:bg-white/[0.06] hover:text-ink'
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <PrimaryButton onClick={logSet} disabled={!current} className="w-full py-3.5">
            Log set
          </PrimaryButton>
        </>
      )}

      {/* prescription (weighted / bodyweight only) */}
      {(isWeighted || isBodyweight) && (
        <>
          <SubTitle className="mt-5">Next session</SubTitle>
          {!current ? (
            <div className="py-4 text-center text-[13px] text-ink-3">Pick a gym and day above.</div>
          ) : rx ? (
            <RxCard rx={rx} name={current.name} unit={unit} />
          ) : (
            <div className="rounded-[14px] border border-white/[0.07] bg-white/[0.025] px-5 py-4">
              <div className="mb-1.5 text-[10.5px] font-bold uppercase tracking-[0.1em] text-ink-3">
                {current.name} · starting point
              </div>
              <div className="mb-2.5 text-[24px] font-bold leading-tight">
                {isBodyweight ? (
                  <>
                    <span className="text-ink">{current.repMin}</span> reps
                  </>
                ) : (
                  <>
                    <span className="text-ink">
                      {current.startWeight || 0}
                      {unit}
                    </span>{' '}
                    × {current.repMin} reps
                  </>
                )}
              </div>
              <span className="mb-2.5 inline-block rounded-full bg-warn/[0.14] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-warn">
                Start here
              </span>
              <p className="m-0 text-[13px] leading-normal text-ink-2">
                {isBodyweight
                  ? `Aim for ${current.repMin}-${current.repMax} clean reps. Once you hit ${current.repMax}+, push for more.`
                  : `Hit ${current.repMin}-${current.repMax} reps. Once logged, the coach will start prescribing.`}
              </p>
            </div>
          )}
        </>
      )}

      {/* stats */}
      <SubTitle className="mt-5">Stats</SubTitle>
      <div className="grid grid-cols-3 gap-2">
        {isCardio ? (
          <>
            <StatBox label="Total distance" value={totalDistance ? totalDistance.toFixed(1) : '—'} unit="km" />
            <StatBox label="Total time" value={totalDuration ? String(Math.round(totalDuration)) : '—'} unit="min" />
            <StatBox label="Sessions" value={logs.length ? String(logs.length) : '—'} />
          </>
        ) : isClass ? (
          <StatBox label="Sessions attended" value={logs.length ? String(logs.length) : '—'} />
        ) : (
          <>
            <StatBox label={isBodyweight ? 'Best reps' : 'Est. 1RM'} value={oneRm} unit={isBodyweight ? 'reps' : unit} />
            <StatBox label="Best set" value={bestSet} />
            <StatBox label="Sessions" value={logs.length ? String(logs.length) : '—'} />
          </>
        )}
      </div>

      {/* trend */}
      {!isClass && (
        <>
          <SubTitle className="mt-5">
            {isCardio ? 'Pace trend (last 10 sessions)' : 'Trend (last 10 sessions)'}
          </SubTitle>
          {trendVals.length < 2 ? (
            <div className="py-4 text-center text-[11px] text-ink-3">Need 2+ sessions for trend</div>
          ) : (
            <TrendSpark vals={trendVals} accent={accent.from} />
          )}
        </>
      )}

      {/* history */}
      <SubTitle className="mt-5">History</SubTitle>
      {!logs.length ? (
        <div className="py-3 text-center text-[12px] italic text-ink-3">No logs yet.</div>
      ) : (
        logs
          .slice()
          .reverse()
          .slice(0, 12)
          .map((l, i) => {
            const origIdx = logs.length - 1 - i;
            const dt = new Date(l.date);
            return (
              <div
                key={`${l.date}-${i}`}
                className="grid grid-cols-[60px_1fr_auto] items-center gap-3 border-b border-white/[0.06] px-1 py-2.5 last:border-b-0"
              >
                <span className="font-mono text-[11px] text-ink-3">{`${dt.getMonth() + 1}/${dt.getDate()}`}</span>
                <span className="text-[14px] font-bold tabular-nums text-ink">
                  {isCardio
                    ? `${l.distanceKm ? `${l.distanceKm.toFixed(1)}km` : ''}${l.distanceKm && l.durationMin ? ' · ' : ''}${l.durationMin ? `${l.durationMin}min` : ''}`
                    : isClass
                      ? 'Attended'
                      : isBodyweight
                        ? `${l.reps} reps${l.weight ? ` · +${l.weight}${unit}` : ''}`
                        : `${l.weight}${unit} × ${l.reps}`}
                  {l.source === 'whoop' && (
                    <span className="ml-1.5 rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.06em] text-ink-3">
                      WHOOP
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    if (!current || !window.confirm('Delete this log?')) return;
                    const arr = (state.logs[current.id] || []).slice();
                    arr.splice(origIdx, 1);
                    const nextLogs = { ...state.logs };
                    if (arr.length) nextLogs[current.id] = arr;
                    else delete nextLogs[current.id];
                    mutate({ logs: nextLogs });
                  }}
                  aria-label="Delete log"
                  className="cursor-pointer px-2 text-ink-4 hover:text-bad"
                >
                  <X size={14} aria-hidden />
                </button>
              </div>
            );
          })
      )}

      {/* today's workout */}
      <SubTitle className="mt-5">Today's workout</SubTitle>
      <div className="rounded-[14px] border border-white/[0.07] bg-white/[0.025] p-4">
        <div className="mb-3 flex items-center justify-between gap-2.5">
          <div>
            <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-ink-3">
              TODAY · {`${DOWS[new Date().getDay()]}, ${MONS[new Date().getMonth()]} ${new Date().getDate()}`}
            </div>
            <div className="flex items-baseline gap-1.5 tabular-nums">
              <span className="text-[26px] font-bold tracking-tight text-ink">{todaySum.totalSets}</span>
              <span className="text-[12px] text-ink-3">sets</span>
              <span className="mx-1 text-ink-4">·</span>
              <span className="text-[13px] text-ink-2">
                {Math.round(todaySum.totalVol).toLocaleString()} {unit} lifted
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={toggleDone}
            disabled={todaySum.totalSets === 0 && !isDoneToday}
            className={`cursor-pointer whitespace-nowrap rounded-full px-4 py-2 text-[12px] font-bold transition-transform hover:-translate-y-px active:scale-[0.98] disabled:opacity-40 ${
              isDoneToday
                ? 'bg-good/[0.16] text-good'
                : 'bg-gradient-to-b from-white to-[#e8e5dd] text-[#0a0a0b]'
            }`}
          >
            {isDoneToday ? '✓ Done' : 'Mark workout done'}
          </button>
        </div>
        {todaySum.totalSets === 0 ? (
          <div className="py-3 text-center text-[12px] italic text-ink-3">
            No sets logged today — log one above and it'll appear here.
          </div>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {todaySum.perEx.map((e) => (
              <li
                key={e.ex.id}
                className="flex items-center justify-between gap-2 rounded-[10px] border border-white/[0.07] bg-white/[0.025] px-3 py-2.5 text-[13px]"
              >
                <span className="min-w-0 break-words font-semibold text-ink">{e.ex.name}</span>
                <span className="font-mono text-[11px] tabular-nums text-ink-3">
                  {summarizeExerciseSets(e.ex, e.sets, unit)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* past workouts */}
      <button
        type="button"
        onClick={() => setPastOpen(!pastOpen)}
        aria-expanded={pastOpen}
        className="mt-2.5 flex w-full cursor-pointer items-center justify-between rounded-[10px] border border-white/[0.07] px-3.5 py-2.5 text-[12px] font-semibold tracking-[0.04em] text-ink-2 transition-colors hover:bg-white/[0.04] hover:text-ink"
      >
        <span>
          Past workouts{' '}
          <span className="ml-1 rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] font-bold tabular-nums text-ink-2">
            {past.length}
          </span>
        </span>
        <span className={`transition-transform ${pastOpen ? 'rotate-180' : ''}`} aria-hidden>
          ▾
        </span>
      </button>
      {pastOpen && (
        <div className="mt-1.5 flex flex-col gap-1.5">
          {!past.length ? (
            <div className="py-4 text-center text-[12px] italic text-ink-3">No past workouts yet.</div>
          ) : (
            past.slice(0, 30).map(([dk, sets]) => {
              const sum = summarizeDay(sets);
              const dt = parseDateKey(dk);
              const names =
                sum.perEx.map((e) => e.ex.name).slice(0, 3).join(', ') + (sum.perEx.length > 3 ? '…' : '');
              return (
                <div key={dk} className="rounded-[10px] border border-white/[0.07] bg-white/[0.025] px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2.5">
                    <span className="font-mono text-[11px] font-bold tracking-[0.06em] text-ink-3">
                      {`${DOWS[dt.getDay()]} ${MONS[dt.getMonth()]} ${dt.getDate()}`}
                    </span>
                    <span className="text-[12px] tabular-nums text-ink-2">
                      {sum.totalSets} sets · {Math.round(sum.totalVol).toLocaleString()} {unit}{' '}
                      {doneDays[dk] && (
                        <span className="ml-1 rounded-full bg-good/[0.14] px-1.5 py-0.5 text-[9px] font-extrabold tracking-[0.08em] text-good">
                          DONE
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="mt-1.5 text-[11px] text-ink-3">{names}</div>
                </div>
              );
            })
          )}
        </div>
      )}
    </Card>
  );
}

function summarizeDay(daySets: { ex: Exercise; log: SetLog }[]) {
  const byEx: Record<string, { ex: Exercise; sets: SetLog[]; vol: number }> = {};
  daySets.forEach(({ ex, log }) => {
    (byEx[ex.id] ||= { ex, sets: [], vol: 0 });
    byEx[ex.id].sets.push(log);
    if (ex.type === 'weighted' || ex.type === 'bodyweight') {
      byEx[ex.id].vol += (log.weight || 0) * (log.reps || 0);
    }
  });
  const perEx = Object.values(byEx);
  return {
    perEx,
    totalSets: perEx.reduce((s, e) => s + e.sets.length, 0),
    totalVol: perEx.reduce((s, e) => s + e.vol, 0),
  };
}

/** One-line summary of a day's sets for an exercise, branched by type. */
function summarizeExerciseSets(ex: Exercise, sets: SetLog[], unit: string): string {
  const n = sets.length;
  const count = `${n} ${ex.type === 'cardio' || ex.type === 'class' ? 'session' : 'set'}${n === 1 ? '' : 's'}`;
  if (ex.type === 'cardio') {
    const km = sets.reduce((s, l) => s + (l.distanceKm || 0), 0);
    const min = sets.reduce((s, l) => s + (l.durationMin || 0), 0);
    const parts = [count];
    if (km > 0) parts.push(`${km.toFixed(1)}km`);
    if (min > 0) parts.push(`${Math.round(min)}min`);
    return parts.join(' · ');
  }
  if (ex.type === 'class') return count;
  if (ex.type === 'bodyweight') {
    const top = Math.max(...sets.map((s) => s.reps || 0));
    return `${count} · top ${top} reps`;
  }
  const top = Math.max(...sets.map((s) => s.weight || 0));
  const vol = sets.reduce((s, l) => s + (l.weight || 0) * (l.reps || 0), 0);
  return `${count} · top ${top}${unit} · ${Math.round(vol)}${unit} total`;
}

function agoLabel(dateIso: string): string {
  const da = Math.floor((Date.now() - new Date(dateIso).getTime()) / 86400000);
  return da === 0 ? 'today' : da === 1 ? 'yesterday' : `${da} days ago`;
}

function RxCard({ rx, name, unit }: { rx: Rx; name: string; unit: string }) {
  const tone =
    rx.type === 'up'
      ? 'border-good/[0.18] bg-gradient-to-b from-good/[0.08] to-white/[0.025]'
      : rx.type === 'down'
        ? 'border-bad/[0.18] bg-gradient-to-b from-bad/[0.08] to-white/[0.025]'
        : 'border-white/[0.07] bg-white/[0.025]';
  const tagTone =
    rx.type === 'up' ? 'bg-good/[0.14] text-good' : rx.type === 'down' ? 'bg-bad/[0.14] text-bad' : 'bg-warn/[0.14] text-warn';
  return (
    <div className={`rounded-[14px] border px-5 py-4 ${tone}`}>
      <div className="mb-1.5 text-[10.5px] font-bold uppercase tracking-[0.1em] text-ink-3">{name}</div>
      <div className="mb-2.5 text-[24px] font-bold leading-tight text-ink-2">
        {rx.bw ? (
          <>
            <span className="text-ink">{rx.reps}</span> reps
          </>
        ) : (
          <>
            <span className="text-ink">
              {rx.weight}
              {unit}
            </span>{' '}
            × {rx.reps} reps
          </>
        )}
      </div>
      <span className={`mb-2.5 inline-block rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.08em] ${tagTone}`}>
        {rx.tag}
      </span>
      <p className="m-0 text-[13px] leading-normal text-ink-2">{rx.reason}</p>
    </div>
  );
}

function TrendSpark({ vals, accent }: { vals: number[]; accent: string }) {
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;
  const W = 300, H = 60, pad = 4;
  const pts = vals.map((v, i) => [
    pad + (W - pad * 2) * (i / (vals.length - 1)),
    H - pad - (H - pad * 2) * ((v - min) / range),
  ]);
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const fill = `${line} L${pts[pts.length - 1][0].toFixed(1)} ${H} L${pts[0][0].toFixed(1)} ${H} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block h-[60px] w-full" aria-hidden>
      <defs>
        <linearGradient id="poSparkGrad" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={accent} stopOpacity="0.22" />
          <stop offset="100%" stopColor={accent} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={fill} fill="url(#poSparkGrad)" />
      <path d={line} fill="none" stroke={accent} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function SubTitle({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`mb-2.5 flex items-center gap-2 text-[10.5px] font-bold uppercase tracking-[0.14em] text-ink-3 ${className || ''}`}>
      <span className="h-px w-6 bg-white/[0.14]" aria-hidden />
      {children}
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-ink-3">{children}</label>;
}

function StatBox({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.025] px-3 py-3.5 text-center">
      <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-ink-3">{label}</div>
      <div className="font-mono text-[21px] font-bold tabular-nums text-ink">
        {value}
        {unit && value !== '—' && <span className="ml-0.5 text-[11px] font-medium text-ink-3">{unit}</span>}
      </div>
    </div>
  );
}

function IconBtn({
  children,
  onClick,
  label,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-white/[0.07] bg-white/[0.04] text-ink-2 transition-colors hover:bg-white/10 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function WBtn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="min-w-12 cursor-pointer rounded-xl border border-white/[0.07] bg-white/[0.04] px-4 text-[20px] font-bold text-ink transition-transform hover:bg-white/10 active:scale-95"
    >
      {children}
    </button>
  );
}

// ============================== MODALS ======================================
function RotationModal({ state, onClose }: { state: PoState; onClose: () => void }) {
  const [draft, setDraft] = React.useState<string[]>(() =>
    state.splitRotation.length ? state.splitRotation.slice() : ['Push', 'Pull', 'Legs', 'Rest'],
  );
  const [todayIdx, setTodayIdx] = React.useState(() => {
    const i = todaySplit(state).index;
    return i < draft.length ? i : 0;
  });
  const [dayDrafts, setDayDrafts] = React.useState<DayConfig[]>(() => state.days.map((d) => ({ ...d })));
  const [expanded, setExpanded] = React.useState<number | null>(null);

  const findDay = (name: string) => dayDrafts.find((d) => d.name.toLowerCase() === name.toLowerCase());
  const updateDay = (id: string, patch: Partial<DayConfig>) =>
    setDayDrafts(dayDrafts.map((d) => (d.id === id ? { ...d, ...patch } : d)));

  const save = () => {
    const cleaned = draft.map((s) => (s || '').trim()).filter(Boolean);
    if (!cleaned.length) {
      alert('Need at least one day in the cycle.');
      return;
    }
    storeSet(PO_KEY, {
      ...loadPoState(),
      splitRotation: cleaned,
      splitAnchor: { date: new Date().toISOString().slice(0, 10), index: todayIdx >= cleaned.length ? 0 : todayIdx },
      days: dayDrafts,
    });
    onClose();
  };

  return (
    <Modal open onClose={onClose} title="Edit split rotation" maxWidth={540}>
      <p className="-mt-1.5 mb-3.5 text-[12px] leading-normal text-ink-3">
        Days cycle in this order, repeating forever. Today is whichever entry is highlighted. Use{' '}
        <strong>Today is →</strong> to jump the cycle to a different starting day. Tap <strong>Plan</strong> to edit
        a day's muscle groups, cardio/class blocks, and pinned exercises.
      </p>
      <div className="mb-2 flex flex-col gap-1.5">
        {draft.map((name, i) => {
          const matchedDay = findDay(name);
          return (
            <div key={i}>
              <div
                className={`grid grid-cols-[auto_1fr_auto_auto_auto_auto_auto] items-center gap-1.5 rounded-lg border px-2.5 py-2 ${
                  i === todayIdx
                    ? 'border-good/30 bg-gradient-to-b from-good/10 to-white/[0.025]'
                    : 'border-white/[0.07] bg-white/[0.025]'
                }`}
              >
                <span className="w-[18px] text-center font-mono text-[11px] font-bold text-ink-3">{i + 1}</span>
                <input
                  value={name}
                  maxLength={30}
                  placeholder="e.g. Arms"
                  onChange={(e) => setDraft(draft.map((x, j) => (j === i ? e.target.value : x)))}
                  className="min-w-0 bg-transparent py-1 text-[13px] text-ink outline-none"
                />
                {i === todayIdx ? (
                  <span className="rounded-full bg-good/[0.16] px-1.5 py-0.5 text-[8px] font-extrabold tracking-[0.1em] text-good">
                    TODAY
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setTodayIdx(i)}
                    className="cursor-pointer rounded-full border border-white/[0.07] bg-white/[0.04] px-2 py-1 text-[9px] font-bold uppercase tracking-[0.06em] text-ink-3 hover:border-good/30 hover:text-good"
                  >
                    Today is →
                  </button>
                )}
                <MiniBtn label="Edit plan" onClick={() => setExpanded(expanded === i ? null : i)}>
                  <Settings2 size={12} aria-hidden />
                </MiniBtn>
                <MiniBtn
                  label="Move up"
                  onClick={() => {
                    if (i === 0) return;
                    const next = draft.slice();
                    [next[i - 1], next[i]] = [next[i], next[i - 1]];
                    setDraft(next);
                    if (todayIdx === i) setTodayIdx(i - 1);
                    else if (todayIdx === i - 1) setTodayIdx(i);
                  }}
                >
                  ↑
                </MiniBtn>
                <MiniBtn
                  label="Move down"
                  onClick={() => {
                    if (i >= draft.length - 1) return;
                    const next = draft.slice();
                    [next[i + 1], next[i]] = [next[i], next[i + 1]];
                    setDraft(next);
                    if (todayIdx === i) setTodayIdx(i + 1);
                    else if (todayIdx === i + 1) setTodayIdx(i);
                  }}
                >
                  ↓
                </MiniBtn>
                <MiniBtn
                  label="Delete"
                  danger
                  onClick={() => {
                    if (draft.length <= 1) {
                      alert('Need at least one day in the cycle.');
                      return;
                    }
                    const next = draft.filter((_, j) => j !== i);
                    setDraft(next);
                    if (todayIdx >= next.length) setTodayIdx(next.length - 1);
                    else if (i < todayIdx) setTodayIdx(todayIdx - 1);
                  }}
                >
                  ×
                </MiniBtn>
              </div>
              {expanded === i && (
                <div className="mb-1.5 mt-1.5 rounded-lg border border-white/[0.07] bg-black/20 p-3">
                  {matchedDay ? (
                    <div className="flex flex-col gap-3">
                      <div>
                        <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-ink-3">
                          Muscle groups
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {(Object.keys(MUSCLE_GROUP_LABELS) as MuscleGroupKey[]).map((k) => {
                            const active = matchedDay.muscleGroups.includes(k);
                            return (
                              <FilterChip
                                key={k}
                                active={active}
                                onClick={() =>
                                  updateDay(matchedDay.id, {
                                    muscleGroups: active
                                      ? matchedDay.muscleGroups.filter((m) => m !== k)
                                      : [...matchedDay.muscleGroups, k],
                                  })
                                }
                              >
                                {MUSCLE_GROUP_LABELS[k]}
                              </FilterChip>
                            );
                          })}
                        </div>
                        <label className="mt-2 flex cursor-pointer items-center gap-1.5 text-[11px] text-ink-2">
                          <input
                            type="checkbox"
                            checked={!!matchedDay.openBodyweight}
                            onChange={(e) => updateDay(matchedDay.id, { openBodyweight: e.target.checked })}
                            className="accent-white"
                          />
                          Open bodyweight day (ignore muscle groups above, recommend any bodyweight move)
                        </label>
                      </div>
                      <div>
                        <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-ink-3">
                          Activities (cardio / class)
                        </div>
                        <ActivitiesEditor
                          activities={matchedDay.activities}
                          onChange={(a) => updateDay(matchedDay.id, { activities: a })}
                        />
                      </div>
                      <ModalField label="Pinned exercise names (comma-separated)">
                        <TextInput
                          defaultValue={matchedDay.pinned.join(', ')}
                          onBlur={(e) =>
                            updateDay(matchedDay.id, {
                              pinned: e.target.value
                                .split(',')
                                .map((s) => s.trim())
                                .filter(Boolean),
                            })
                          }
                        />
                      </ModalField>
                    </div>
                  ) : (
                    <p className="m-0 text-[12px] text-ink-3">
                      This day has no plan details yet — add it under Settings → Days first, then its plan becomes
                      editable here.
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <button
        type="button"
        onClick={() => setDraft([...draft, 'New day'])}
        className="w-full cursor-pointer rounded-lg border border-dashed border-white/[0.07] bg-white/[0.025] py-2.5 text-[12px] text-ink-2 hover:bg-white/[0.05] hover:text-ink"
      >
        + Add day
      </button>
      <div className="mt-4 flex gap-2">
        <GhostButton onClick={onClose} className="flex-1">
          Cancel
        </GhostButton>
        <PrimaryButton onClick={save} className="flex-1">
          Save
        </PrimaryButton>
      </div>
    </Modal>
  );
}

// ============================== EXERCISE DATABASE ==========================
function ExerciseDbModal({
  db,
  dbError,
  state,
  onAdd,
  onClose,
}: {
  db: DbExercise[];
  dbError: string | null;
  state: PoState;
  onAdd: (rec: DbExercise) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = React.useState('');
  const [muscle, setMuscle] = React.useState<MuscleGroupKey | ''>('');
  const [equipOnly, setEquipOnly] = React.useState(false);
  const [level, setLevel] = React.useState('');
  const [detail, setDetail] = React.useState<DbExercise | null>(null);

  const results = React.useMemo(() => {
    if (!db.length) return [];
    return searchExercises(db, query, {
      primaryMuscles: muscle ? MUSCLE_GROUP_MAP[muscle] : undefined,
      equipment: equipOnly ? new Set(state.availableEquipment) : undefined,
      level: level || undefined,
      limit: 40,
    });
  }, [db, query, muscle, equipOnly, level, state.availableEquipment]);

  const dayName = state.days.find((d) => d.id === state.filterDay)?.name || 'today';

  if (detail) {
    return (
      <Modal open onClose={() => setDetail(null)} title={detail.name} maxWidth={480}>
        <ExerciseDetail rec={detail} />
        <div className="mt-4 flex gap-2">
          <GhostButton onClick={() => setDetail(null)} className="flex-1">
            Back
          </GhostButton>
          <PrimaryButton onClick={() => onAdd(detail)} className="flex-1">
            Add to {dayName}
          </PrimaryButton>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open onClose={onClose} title="Exercise database" maxWidth={520}>
      <TextInput
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search e.g. incline db press"
        className="mb-3 w-full"
      />
      <div className="mb-3 flex flex-wrap gap-1.5">
        <FilterChip active={muscle === ''} onClick={() => setMuscle('')}>
          All muscles
        </FilterChip>
        {(Object.keys(MUSCLE_GROUP_LABELS) as MuscleGroupKey[]).map((k) => (
          <FilterChip key={k} active={muscle === k} onClick={() => setMuscle(muscle === k ? '' : k)}>
            {MUSCLE_GROUP_LABELS[k]}
          </FilterChip>
        ))}
      </div>
      <div className="mb-3 flex items-center gap-3">
        <label className="flex cursor-pointer items-center gap-1.5 text-[12px] text-ink-2">
          <input
            type="checkbox"
            checked={equipOnly}
            onChange={(e) => setEquipOnly(e.target.checked)}
            className="accent-white"
          />
          My equipment only
        </label>
        <SelectInput value={level} onChange={(e) => setLevel(e.target.value)} className="ml-auto text-[12px]">
          <option value="">Any level</option>
          <option value="beginner">Beginner</option>
          <option value="intermediate">Intermediate</option>
          <option value="expert">Expert</option>
        </SelectInput>
      </div>
      {dbError && (
        <div className="mb-3 rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-[12px] text-bad">
          Couldn't load the exercise database: {dbError}
        </div>
      )}
      {!dbError && !db.length && <EmptyState>Loading exercise database…</EmptyState>}
      <div className="flex max-h-[50vh] flex-col gap-1.5 overflow-y-auto">
        {db.length > 0 && results.length === 0 && (
          <EmptyState>No matches. Try a different search or filter.</EmptyState>
        )}
        {results.map((rec) => (
          <button
            key={rec.id}
            type="button"
            onClick={() => setDetail(rec)}
            className="flex cursor-pointer items-center justify-between gap-2 rounded-[10px] border border-white/[0.07] bg-white/[0.025] px-3 py-2.5 text-left text-[13px] transition-colors hover:border-white/[0.14] hover:bg-white/[0.05]"
          >
            <span className="min-w-0 truncate font-semibold text-ink">{rec.name}</span>
            <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.06em] text-ink-3">
              {deriveExerciseType(rec)}
            </span>
          </button>
        ))}
      </div>
      {results.length >= 40 && (
        <div className="mt-2 text-center text-[11px] text-ink-4">
          Showing first 40 — narrow your search for more.
        </div>
      )}
    </Modal>
  );
}

function FilterChip({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`cursor-pointer rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
        active
          ? 'border-transparent bg-gradient-to-b from-white to-[#e8e5dd] text-[#0a0a0b]'
          : 'border-white/[0.07] bg-white/[0.04] text-ink-2 hover:text-ink'
      }`}
    >
      {children}
    </button>
  );
}

function ExerciseDetail({ rec }: { rec: DbExercise }) {
  const [showImg, setShowImg] = React.useState(false);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1.5">
        <Tag>{deriveExerciseType(rec)}</Tag>
        {rec.equipment && <Tag>{rec.equipment}</Tag>}
        <Tag>{rec.level}</Tag>
        {rec.primaryMuscles.map((m) => (
          <Tag key={m}>{m}</Tag>
        ))}
      </div>
      {!showImg ? (
        <button
          type="button"
          onClick={() => setShowImg(true)}
          className="cursor-pointer rounded-lg border border-dashed border-white/[0.07] py-2 text-center text-[12px] text-ink-3 hover:text-ink"
        >
          Show image
        </button>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={exerciseImageUrl(rec.id)}
          alt={rec.name}
          className="w-full rounded-xl border border-white/[0.07]"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = 'none';
          }}
        />
      )}
      {rec.instructions.length > 0 && (
        <ol className="m-0 flex list-decimal flex-col gap-1.5 pl-4 text-[12.5px] leading-normal text-ink-2">
          {rec.instructions.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
      )}
    </div>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-white/[0.06] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.04em] text-ink-3">
      {children}
    </span>
  );
}

function ActivitiesEditor({
  activities,
  onChange,
}: {
  activities: PlanActivity[];
  onChange: (a: PlanActivity[]) => void;
}) {
  const [newType, setNewType] = React.useState<'cardio' | 'class'>('cardio');
  const [newLabel, setNewLabel] = React.useState('');

  return (
    <div className="flex flex-col gap-1.5">
      {activities.map((a, i) => (
        <div
          key={i}
          className="flex items-center gap-2 rounded-lg border border-white/[0.07] bg-white/[0.025] px-2.5 py-1.5 text-[12px]"
        >
          <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] font-bold uppercase text-ink-3">
            {a.type}
          </span>
          <span className="flex-1 text-ink">{a.label}</span>
          <button
            type="button"
            onClick={() => onChange(activities.filter((_, j) => j !== i))}
            aria-label="Remove activity"
            className="cursor-pointer text-ink-4 hover:text-bad"
          >
            <X size={12} aria-hidden />
          </button>
        </div>
      ))}
      <div className="flex gap-1.5">
        <SelectInput
          value={newType}
          onChange={(e) => setNewType(e.target.value as 'cardio' | 'class')}
          className="text-[12px]"
        >
          <option value="cardio">Cardio</option>
          <option value="class">Class</option>
        </SelectInput>
        <input
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          placeholder="e.g. Sprints"
          className="min-w-0 flex-1 rounded-lg border border-white/[0.07] bg-black/30 px-2.5 py-1.5 text-[12px] text-ink outline-none"
        />
        <button
          type="button"
          onClick={() => {
            if (!newLabel.trim()) return;
            onChange([...activities, { type: newType, label: newLabel.trim() }]);
            setNewLabel('');
          }}
          className="cursor-pointer rounded-lg border border-white/[0.07] bg-white/[0.04] px-3 text-[12px] font-bold text-ink-2 hover:text-ink"
        >
          +
        </button>
      </div>
    </div>
  );
}

function MiniBtn({
  children,
  onClick,
  label,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`cursor-pointer px-1.5 py-1 text-[14px] text-ink-3 ${danger ? 'hover:text-bad' : 'hover:text-ink'}`}
    >
      {children}
    </button>
  );
}

function ExerciseModal({
  state,
  mode,
  exercise,
  onClose,
}: {
  state: PoState;
  mode: 'add' | 'edit';
  exercise?: Exercise;
  onClose: () => void;
}) {
  const [name, setName] = React.useState(exercise?.name || '');
  const [gym, setGym] = React.useState(exercise?.gym || state.filterGym);
  const [day, setDay] = React.useState(exercise?.day || state.filterDay);
  const [type, setType] = React.useState<ExerciseType>(exercise?.type || 'weighted');
  const [startWeight, setStartWeight] = React.useState(String(exercise?.startWeight ?? 20));
  const [repMin, setRepMin] = React.useState(String(exercise?.repMin ?? 6));
  const [repMax, setRepMax] = React.useState(String(exercise?.repMax ?? 8));
  const [step, setStep] = React.useState(String(exercise?.step ?? 2.5));

  const isWeighted = type === 'weighted';
  const isBodyweight = type === 'bodyweight';
  const needsSetsReps = isWeighted || isBodyweight;

  const save = () => {
    if (!name.trim()) {
      alert('Name is required.');
      return;
    }
    const s = loadPoState();
    const data = {
      name: name.trim(),
      gym,
      day,
      type,
      startWeight: needsSetsReps ? (isWeighted ? parseFloat(startWeight) || 0 : 0) : undefined,
      repMin: needsSetsReps ? parseInt(repMin, 10) || 6 : undefined,
      repMax: needsSetsReps ? parseInt(repMax, 10) || 8 : undefined,
      step: needsSetsReps ? (isBodyweight ? 1 : parseFloat(step) || 2.5) : undefined,
    };
    if (mode === 'edit' && exercise) {
      storeSet(PO_KEY, {
        ...s,
        exercises: s.exercises.map((e) => (e.id === exercise.id ? { ...e, ...data } : e)),
      });
    } else {
      const ex: Exercise = { id: `ex_${Date.now()}_${Math.floor(Math.random() * 9999)}`, ...data };
      storeSet(PO_KEY, {
        ...s,
        exercises: [...s.exercises, ex],
        currentEx: ex.id,
        filterGym: gym === 'both' ? s.filterGym : gym,
        filterDay: day,
      });
    }
    onClose();
  };

  const del = () => {
    if (!exercise || !window.confirm('Delete this exercise and all its logs?')) return;
    const s = loadPoState();
    const nextLogs = { ...s.logs };
    delete nextLogs[exercise.id];
    storeSet(PO_KEY, {
      ...s,
      exercises: s.exercises.filter((e) => e.id !== exercise.id),
      logs: nextLogs,
      currentEx: s.currentEx === exercise.id ? null : s.currentEx,
    });
    onClose();
  };

  return (
    <Modal open onClose={onClose} title={mode === 'edit' ? 'Edit exercise' : 'Add exercise'}>
      <div className="flex flex-col gap-3">
        <ModalField label="Name">
          <TextInput autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Incline DB press" />
        </ModalField>
        <ModalField label="Gym">
          <Seg
            options={[...state.gyms.map((g) => ({ value: g.id, label: g.name })), { value: 'both', label: 'Both' }]}
            value={gym}
            onChange={setGym}
          />
        </ModalField>
        <ModalField label="Day">
          <Seg options={state.days.map((d) => ({ value: d.id, label: d.name }))} value={day} onChange={setDay} />
        </ModalField>
        <ModalField label="Type">
          <Seg
            options={[
              { value: 'weighted', label: 'Weighted' },
              { value: 'bodyweight', label: 'Bodyweight' },
              { value: 'cardio', label: 'Cardio' },
              { value: 'class', label: 'Class' },
            ]}
            value={type}
            onChange={setType}
          />
        </ModalField>
        {type === 'cardio' && (
          <p className="m-0 text-[12px] text-ink-3">Logs distance, duration, and pace. No sets/reps.</p>
        )}
        {type === 'class' && (
          <p className="m-0 text-[12px] text-ink-3">Logs attendance only — no metrics.</p>
        )}
        {isWeighted && (
          <ModalField label="Starting weight">
            <TextInput type="number" step="0.5" value={startWeight} onChange={(e) => setStartWeight(e.target.value)} />
          </ModalField>
        )}
        {needsSetsReps && (
          <div className="grid grid-cols-2 gap-2.5">
            <ModalField label="Reps min">
              <TextInput type="number" value={repMin} onChange={(e) => setRepMin(e.target.value)} />
            </ModalField>
            <ModalField label="Reps max">
              <TextInput type="number" value={repMax} onChange={(e) => setRepMax(e.target.value)} />
            </ModalField>
          </div>
        )}
        {isWeighted && (
          <ModalField label="Increment">
            <TextInput type="number" step="0.5" value={step} onChange={(e) => setStep(e.target.value)} />
          </ModalField>
        )}
      </div>
      <div className="mt-4 flex gap-2">
        <GhostButton onClick={onClose} className="flex-1">
          Cancel
        </GhostButton>
        <PrimaryButton onClick={save} className="flex-1">
          Save
        </PrimaryButton>
      </div>
      {mode === 'edit' && (
        <button
          type="button"
          onClick={del}
          className="mt-3 block w-full cursor-pointer py-1.5 text-center text-[12px] text-bad underline"
        >
          Delete this exercise
        </button>
      )}
    </Modal>
  );
}

function ModalField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[11px] font-bold uppercase tracking-[0.04em] text-ink-3">{label}</label>
      {children}
    </div>
  );
}

function SettingsModal({ state, onClose }: { state: PoState; onClose: () => void }) {
  const fileRef = React.useRef<HTMLInputElement>(null);
  const s = state;

  return (
    <Modal open onClose={onClose} title="Settings" maxWidth={480}>
      <div className="mb-5">
        <Eyebrow className="mb-2">Units</Eyebrow>
        <Seg
          options={[
            { value: 'kg', label: 'kg' },
            { value: 'lb', label: 'lb' },
          ]}
          value={s.units}
          onChange={(v) => storeSet(PO_KEY, { ...loadPoState(), units: v })}
        />
      </div>

      {(['gyms', 'days'] as const).map((kind) => (
        <div key={kind} className="mb-5">
          <Eyebrow className="mb-2">{kind === 'gyms' ? 'Gyms' : 'Days'}</Eyebrow>
          <div className="flex flex-col gap-1.5">
            {s[kind].map((row, i) => (
              <div
                key={row.id}
                className="flex items-center gap-2 rounded-lg border border-white/[0.07] bg-white/[0.025] px-2.5 py-2"
              >
                <input
                  defaultValue={row.name}
                  placeholder={kind === 'gyms' ? 'Gym name' : 'Day name'}
                  onChange={(e) => {
                    const cur = loadPoState();
                    const arr = cur[kind].slice();
                    arr[i] = { ...arr[i], name: e.target.value };
                    storeSet(PO_KEY, { ...cur, [kind]: arr });
                  }}
                  className="min-w-0 flex-1 bg-transparent py-1 text-[13px] text-ink outline-none"
                />
                <button
                  type="button"
                  aria-label="Delete"
                  onClick={() => {
                    const cur = loadPoState();
                    if (cur[kind].length <= 1) {
                      alert(`You need at least one ${kind === 'gyms' ? 'gym' : 'day'}.`);
                      return;
                    }
                    if (
                      !window.confirm(
                        kind === 'gyms'
                          ? `Remove "${cur.gyms[i].name}"? Exercises tagged to this gym will become invisible until you reassign them.`
                          : `Remove "${cur.days[i].name}"?`,
                      )
                    )
                      return;
                    const arr = cur[kind].slice();
                    arr.splice(i, 1);
                    const patch: Partial<PoState> = { [kind]: arr };
                    if (kind === 'gyms' && !arr.find((g) => g.id === cur.filterGym)) patch.filterGym = arr[0].id;
                    if (kind === 'days' && !arr.find((d) => d.id === cur.filterDay)) patch.filterDay = arr[0].id;
                    storeSet(PO_KEY, { ...cur, ...patch });
                  }}
                  className="cursor-pointer px-1.5 text-ink-4 hover:text-bad"
                >
                  <X size={13} aria-hidden />
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              const name = (prompt(`New ${kind === 'gyms' ? 'gym' : 'day'} name:`) || '').trim();
              if (!name) return;
              const cur = loadPoState();
              storeSet(PO_KEY, {
                ...cur,
                [kind]: [...cur[kind], { id: `${kind === 'gyms' ? 'g' : 'd'}_${Date.now()}`, name }],
              });
            }}
            className="mt-1.5 w-full cursor-pointer rounded-lg border border-dashed border-white/[0.07] bg-white/[0.025] py-2 text-[12px] text-ink-2 hover:text-ink"
          >
            + Add {kind === 'gyms' ? 'gym' : 'day'}
          </button>
        </div>
      ))}

      <div className="mb-5">
        <Eyebrow className="mb-2">Equipment</Eyebrow>
        <p className="mb-2 text-[12px] leading-normal text-ink-3">
          Recommendations only suggest exercises you can actually do. Bodyweight exercises always pass regardless of
          what's checked here.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {EQUIPMENT_VOCAB.map((eq) => {
            const active = s.availableEquipment.includes(eq);
            return (
              <FilterChip
                key={eq}
                active={active}
                onClick={() => {
                  const cur = loadPoState();
                  const next = active
                    ? cur.availableEquipment.filter((x) => x !== eq)
                    : [...cur.availableEquipment, eq];
                  storeSet(PO_KEY, { ...cur, availableEquipment: next });
                }}
              >
                {EQUIPMENT_LABELS[eq]}
              </FilterChip>
            );
          })}
        </div>
      </div>

      <div className="mb-5">
        <Eyebrow className="mb-2">Data</Eyebrow>
        <div className="flex flex-wrap gap-2">
          <GhostButton
            onClick={() => {
              const blob = new Blob([JSON.stringify(loadPoState(), null, 2)], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `po-coach-data-${new Date().toISOString().slice(0, 10)}.json`;
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            Export JSON
          </GhostButton>
          <GhostButton onClick={() => fileRef.current?.click()}>Import JSON</GhostButton>
          <DangerGhostButton
            onClick={() => {
              if (!window.confirm('Delete EVERYTHING (logs, edits, gyms, days)? This cannot be undone.')) return;
              storeRemove(PO_KEY);
              onClose();
            }}
          >
            Reset all
          </DangerGhostButton>
          <input
            ref={fileRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const reader = new FileReader();
              reader.onload = () => {
                try {
                  const parsed = JSON.parse(String(reader.result));
                  if (!window.confirm('Replace ALL current data with the imported file? This cannot be undone.')) return;
                  storeSet(PO_KEY, normalizePoState(parsed));
                } catch (err) {
                  alert(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
                }
              };
              reader.readAsText(file);
              e.target.value = '';
            }}
          />
        </div>
      </div>

      <PrimaryButton onClick={onClose} className="w-full">
        Done
      </PrimaryButton>
    </Modal>
  );
}
