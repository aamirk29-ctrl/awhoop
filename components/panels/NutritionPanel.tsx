'use client';

// Nutrition panel — daily calorie/protein targets.
//
//   target = max(today's live WHOOP burn, personalized floor) × (1 − deficit)
//
// The floor keeps the target at a sensible full-day number from wake-up; WHOOP
// can only ever raise it on a high-burn day, never drag it down to a partial
// morning figure. The floor is the Mifflin-St Jeor TDEE until 10 closed days
// of real burn exist, then a rolling 10-day average of measured burn.

import * as React from 'react';
import { ChevronDown, RefreshCw, Settings2 } from 'lucide-react';
import type { BentoAccent } from '@/components/ui/aurora-bento-grid';
import { storeSet, useStorageTick } from '@/lib/storage';
import {
  ACTIVITY_FACTORS,
  ACTIVITY_LABELS,
  FLOOR_MIN_DAYS,
  FLOOR_WINDOW,
  NUTRITION_KEY,
  loadNutritionState,
  resolveTargets,
  type ActivityLevel,
  type NutritionState,
  type Sex,
} from '@/lib/nutrition';
import { useWhoopEnergy } from '@/lib/whoop';
import { entriesFor, loadFoodLog, progress, totalsFor } from '@/lib/food';
import FoodLogger from './FoodLogger';
import MealPresets from './MealPresets';
import { Card, Eyebrow, Modal, PrimaryButton, Seg, SelectInput, TextInput } from './shared';

const kcal = (n: number) => Math.round(n).toLocaleString();

export default function NutritionPanel({ accent }: { accent: BentoAccent }) {
  const tick = useStorageTick();
  const state = React.useMemo(() => loadNutritionState(), [tick]);
  const [whyOpen, setWhyOpen] = React.useState(false);
  const [settingsOpen, setSettingsOpen] = React.useState(false);

  const { energy, closedBurns, connected, loading, error, refresh } = useWhoopEnergy();
  const save = (next: NutritionState) => storeSet(NUTRITION_KEY, next);

  const t = resolveTargets(state, energy, closedBurns);
  const rolling = t.floor.source === 'rolling';

  // Re-reads on every storage write, so logging a food updates these instantly.
  const entries = React.useMemo(() => entriesFor(loadFoodLog()), [tick]);
  const consumed = totalsFor(entries);
  const calProg = progress(consumed.kcal, t.calorie.calorieTarget);
  const proProg = progress(consumed.protein, t.proteinTarget);

  return (
    <div className="flex flex-col gap-4 pb-2 pt-2">
      <Card>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Eyebrow>DAILY TARGETS</Eyebrow>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <SourceBadge
                whoopRaising={t.whoopRaising}
                rolling={rolling}
                estimated={t.estimated}
                accent={accent}
              />
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {connected && (
              <button
                type="button"
                onClick={refresh}
                aria-label="Refresh WHOOP burn"
                className={`flex h-9 w-9 cursor-pointer items-center justify-center rounded-[10px] border border-white/[0.07] bg-white/[0.04] text-ink-2 transition-colors hover:bg-white/[0.08] hover:text-ink ${loading ? 'animate-spin' : ''}`}
              >
                <RefreshCw size={15} aria-hidden />
              </button>
            )}
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              aria-label="Settings"
              className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-[10px] border border-white/[0.07] bg-white/[0.04] text-ink-2 transition-colors hover:bg-white/[0.08] hover:text-ink"
            >
              <Settings2 size={16} aria-hidden />
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <MacroProgress
            label="Calories"
            unit="kcal"
            consumed={calProg.consumed}
            target={calProg.target}
            pct={calProg.pct}
            over={calProg.over}
            remaining={calProg.remaining}
            color={accent.text}
            gradient={`linear-gradient(90deg, ${accent.from}, ${accent.to})`}
          />
          <MacroProgress
            label="Protein"
            unit="g"
            consumed={proProg.consumed}
            target={proProg.target}
            pct={proProg.pct}
            over={proProg.over}
            remaining={proProg.remaining}
            color="#E8E5DD"
            gradient="linear-gradient(90deg, #E8E5DD, #B8B6B0)"
            decimals
          />
        </div>

        <p className="mt-3 text-[11.5px] leading-snug text-ink-3">
          {t.whoopRaising ? (
            <>
              Today&rsquo;s burn is running above your floor, so WHOOP is driving the target up
              {t.estimated ? ' — and it keeps climbing until the cycle closes after your next sleep' : ''}.
            </>
          ) : (
            <>
              Held at your {rolling ? `${FLOOR_WINDOW}-day` : 'baseline'} floor of{' '}
              <span className="font-mono font-semibold text-ink-2">{kcal(t.floor.kcal)} kcal</span> burn.
              {t.liveBurnKcal != null
                ? ` Today's burn so far (${kcal(t.liveBurnKcal)}) is below it, so it's ignored — the target only ever moves up.`
                : ''}
            </>
          )}
        </p>

        {error && (
          <div className="mt-3 rounded-[10px] border border-warn/25 bg-warn/10 px-3 py-2 font-mono text-[11px] text-warn">
            {error} — holding at the floor.
          </div>
        )}
        {!connected && (
          <p className="mt-2 text-[11.5px] leading-snug text-ink-3">
            WHOOP not connected. Connect from the Stack panel to let high-burn days raise this.
          </p>
        )}

        <button
          type="button"
          onClick={() => setWhyOpen(!whyOpen)}
          aria-expanded={whyOpen}
          className="mt-4 flex w-full cursor-pointer items-center justify-between rounded-[10px] border border-white/[0.07] px-3.5 py-2.5 text-[12px] font-semibold tracking-[0.04em] text-ink-2 transition-colors hover:bg-white/[0.04] hover:text-ink"
        >
          <span>Why these targets?</span>
          <ChevronDown size={14} className={`transition-transform ${whyOpen ? 'rotate-180' : ''}`} aria-hidden />
        </button>
        {whyOpen && (
          <div className="mt-2 rounded-[10px] border border-white/[0.07] bg-white/[0.025] px-4 py-3.5">
            {/* the floor */}
            {rolling ? (
              <WhyRow
                label={`Floor · rolling avg of last ${FLOOR_WINDOW} closed days`}
                val={`${kcal(t.floor.kcal)} kcal`}
              />
            ) : (
              <>
                <WhyRow
                  label={`BMR (${state.stats.sex === 'm' ? 'male' : 'female'} · ${state.stats.weightKg}kg · ${state.stats.heightCm}cm · ${state.stats.age}y)`}
                  val={`${kcal(t.calorie.bmr)} kcal`}
                />
                <WhyRow
                  label={`× activity (${ACTIVITY_LABELS[state.stats.activityLevel]}, ×${ACTIVITY_FACTORS[state.stats.activityLevel]})`}
                  val={`${kcal(t.floor.kcal)} kcal floor`}
                />
              </>
            )}

            {/* today's live burn, and which side of the max() won */}
            <WhyRow
              label={`Today's WHOOP burn${t.estimated ? ' (cycle open)' : t.liveBurnKcal != null ? ' (cycle closed)' : ''}`}
              val={t.liveBurnKcal != null ? `${kcal(t.liveBurnKcal)} kcal` : '—'}
            />
            <div className="my-2 border-t border-white/[0.07]" />
            <WhyRow
              label={`max(burn, floor) → ${t.whoopRaising ? 'WHOOP burn' : 'floor'} wins`}
              val={`${kcal(t.calorie.tdee)} kcal`}
            />
            <WhyRow
              label={`− deficit (${t.calorie.deficitPct}%)`}
              val={`− ${kcal(t.calorie.deficitKcal)} kcal`}
            />
            <div className="mt-2 flex items-baseline justify-between border-t border-white/[0.07] pt-2.5 text-[13px] tabular-nums">
              <span className="font-bold text-good">Calorie target</span>
              <span className="font-mono font-semibold text-good">
                {kcal(t.calorie.calorieTarget)} kcal
              </span>
            </div>

            <p className="mt-2 text-[11px] italic leading-snug text-ink-3">
              {rolling
                ? `Floor is measured from your own last ${FLOOR_WINDOW} closed days. Mifflin-St Jeor would have given ${kcal(t.baseline.calorieTarget)} kcal (TDEE ${kcal(t.baseline.tdee)}).`
                : `Floor is the Mifflin-St Jeor estimate for now. After ${FLOOR_MIN_DAYS} closed WHOOP days it switches to a rolling ${FLOOR_WINDOW}-day average of your real burn — ${t.floor.daysAvailable}/${FLOOR_MIN_DAYS} so far.`}
            </p>

            <div className="mt-3.5 border-t border-white/[0.07] pt-3">
              <WhyRow
                label={`Protein (${state.settings.proteinPerKg} g × ${state.stats.weightKg}kg)`}
                val={`${Math.round(t.proteinTarget)} g`}
              />
              <p className="mt-1 text-[11px] italic leading-snug text-ink-3">
                Protein scales with bodyweight only — independent of burn.
              </p>
            </div>
          </div>
        )}
      </Card>

      {/* progress toward the personalized floor */}
      {connected && !rolling && (
        <Card>
          <Eyebrow className="mb-2.5">PERSONALIZING</Eyebrow>
          <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
            <div
              className="h-full rounded-full transition-[width] duration-500"
              style={{
                width: `${Math.min(100, (t.floor.daysAvailable / FLOOR_MIN_DAYS) * 100)}%`,
                background: `linear-gradient(90deg, ${accent.from}, ${accent.to})`,
              }}
            />
          </div>
          <p className="text-[11.5px] leading-snug text-ink-3">
            <span className="font-mono font-semibold text-ink-2">
              {t.floor.daysAvailable}/{FLOOR_MIN_DAYS}
            </span>{' '}
            closed WHOOP days stored.{' '}
            {t.floor.daysUntilRolling > 0
              ? `${t.floor.daysUntilRolling} more and your floor switches from the Mifflin estimate to a rolling ${FLOOR_WINDOW}-day average of your real burn.`
              : 'Rolling average active.'}
          </p>
        </Card>
      )}

      {energy && (
        <Card>
          <Eyebrow className="mb-3">TODAY&rsquo;S BURN</Eyebrow>
          <BurnSplit energy={energy} accent={accent} />
        </Card>
      )}

      {/* Saved meals sit above search: re-logging a known meal is the fast path,
          and it's what this panel gets opened for most often. */}
      <MealPresets entries={entries} accent={accent} />

      <FoodLogger entries={entries} accent={accent} />

      <NutritionSettings open={settingsOpen} onClose={() => setSettingsOpen(false)} state={state} save={save} />
    </div>
  );
}

/** Consumed-vs-target bar. Goes amber past 100% rather than silently capping. */
function MacroProgress({
  label,
  unit,
  consumed,
  target,
  pct,
  over,
  remaining,
  color,
  gradient,
  decimals,
}: {
  label: string;
  unit: string;
  consumed: number;
  target: number;
  pct: number;
  over: boolean;
  remaining: number;
  color: string;
  gradient: string;
  decimals?: boolean;
}) {
  const fmt = (n: number) => (decimals ? Math.round(n * 10) / 10 : Math.round(n)).toLocaleString();

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.1em] text-ink-3">
          {label}
        </span>
        <span className={`font-mono text-[10.5px] font-semibold tabular-nums ${over ? 'text-warn' : 'text-ink-3'}`}>
          {over ? `${fmt(consumed - target)} ${unit} over` : `${fmt(remaining)} ${unit} left`}
        </span>
      </div>
      <div className="mt-1.5 flex items-baseline gap-1.5">
        <span
          className="font-mono text-[34px] font-bold leading-none tracking-tight tabular-nums"
          style={{ color: over ? undefined : color }}
        >
          {fmt(consumed)}
        </span>
        <span className="text-[13px] font-medium text-ink-3">
          / {fmt(target)} {unit}
        </span>
      </div>
      <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-white/[0.05]">
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{
            width: `${Math.max(pct, consumed > 0 ? 2 : 0)}%`,
            background: over ? 'linear-gradient(90deg, #F2C063, #FF8A8A)' : gradient,
          }}
        />
      </div>
    </div>
  );
}

/** Says which side of the max() is driving the target, and how the floor is derived. */
function SourceBadge({
  whoopRaising,
  rolling,
  estimated,
  accent,
}: {
  whoopRaising: boolean;
  rolling: boolean;
  estimated: boolean;
  accent: BentoAccent;
}) {
  return (
    <>
      {whoopRaising ? (
        <span
          className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.14em]"
          style={{ borderColor: `${accent.from}55`, background: `${accent.from}1a`, color: accent.text }}
        >
          <span
            className="h-1.5 w-1.5 animate-pulse rounded-full"
            style={{ background: accent.from }}
            aria-hidden
          />
          WHOOP raising
        </span>
      ) : (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.1] bg-white/[0.04] px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.14em] text-ink-3">
          {rolling ? `${FLOOR_WINDOW}-day floor` : 'Baseline floor'}
        </span>
      )}
      {estimated && (
        <span className="inline-flex items-center rounded-full border border-warn/30 bg-warn/10 px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.14em] text-warn">
          Estimated
        </span>
      )}
    </>
  );
}

/** Resting vs training split of today's burn. */
function BurnSplit({
  energy,
  accent,
}: {
  energy: { totalKcal: number; restingKcal: number; workoutKcal: number; strain: number | null };
  accent: BentoAccent;
}) {
  const total = Math.max(1, energy.totalKcal);
  const restPct = (energy.restingKcal / total) * 100;
  const workPct = (energy.workoutKcal / total) * 100;

  return (
    <>
      <div className="mb-3 flex h-2.5 overflow-hidden rounded-full border border-white/[0.04] bg-white/[0.04]">
        <div style={{ width: `${restPct}%`, background: `${accent.from}88` }} />
        <div style={{ width: `${workPct}%`, background: accent.to }} />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <BurnStat label="Resting" value={`${kcal(energy.restingKcal)}`} dot={`${accent.from}88`} />
        <BurnStat label="Training" value={`${kcal(energy.workoutKcal)}`} dot={accent.to} />
        <BurnStat
          label="Total"
          value={`${kcal(energy.totalKcal)}`}
          sub={energy.strain != null ? `strain ${energy.strain.toFixed(1)}` : undefined}
        />
      </div>
    </>
  );
}

function BurnStat({
  label,
  value,
  dot,
  sub,
}: {
  label: string;
  value: string;
  dot?: string;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border border-white/[0.04] bg-white/[0.025] px-2.5 py-3 text-center">
      <div className="mb-1.5 flex items-center justify-center gap-1.5">
        {dot && <span className="h-2 w-2 rounded-[2px]" style={{ background: dot }} aria-hidden />}
        <span className="text-[9.5px] font-bold uppercase tracking-[0.14em] text-ink-3">{label}</span>
      </div>
      <div className="font-mono text-[18px] font-bold leading-none tracking-tight text-ink tabular-nums">
        {value}
      </div>
      <div className="mt-1.5 font-mono text-[10px] text-ink-3">{sub || 'kcal'}</div>
    </div>
  );
}

function WhyRow({ label, val }: { label: string; val: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 text-[13px] tabular-nums">
      <span className="text-ink-2">{label}</span>
      <span className="shrink-0 font-mono font-semibold text-ink">{val}</span>
    </div>
  );
}

// ---- settings ---------------------------------------------------------------
function NutritionSettings({
  open,
  onClose,
  state,
  save,
}: {
  open: boolean;
  onClose: () => void;
  state: NutritionState;
  save: (s: NutritionState) => void;
}) {
  const num = (v: string) => parseFloat(v) || 0;

  return (
    <Modal open={open} onClose={onClose} title="Settings" maxWidth={480}>
      <Section title="Stats">
        <div className="grid grid-cols-2 gap-2.5">
          <Field label="Weight (kg)">
            <TextInput
              type="number"
              step="0.1"
              value={state.stats.weightKg}
              onChange={(e) => save({ ...state, stats: { ...state.stats, weightKg: num(e.target.value) } })}
            />
          </Field>
          <Field label="Height (cm)">
            <TextInput
              type="number"
              step="0.5"
              value={state.stats.heightCm}
              onChange={(e) => save({ ...state, stats: { ...state.stats, heightCm: num(e.target.value) } })}
            />
          </Field>
          <Field label="Age">
            <TextInput
              type="number"
              value={state.stats.age}
              onChange={(e) => save({ ...state, stats: { ...state.stats, age: num(e.target.value) } })}
            />
          </Field>
          <Field label="Sex">
            <Seg
              options={[
                { value: 'm', label: 'Male' },
                { value: 'f', label: 'Female' },
              ]}
              value={state.stats.sex}
              onChange={(v) => save({ ...state, stats: { ...state.stats, sex: v as Sex } })}
            />
          </Field>
        </div>

        <Field label="Activity level" className="mt-2.5">
          <SelectInput
            value={state.stats.activityLevel}
            onChange={(e) =>
              save({ ...state, stats: { ...state.stats, activityLevel: e.target.value as ActivityLevel } })
            }
          >
            {(Object.keys(ACTIVITY_LABELS) as ActivityLevel[]).map((k) => (
              <option key={k} value={k}>
                {ACTIVITY_LABELS[k]}
              </option>
            ))}
          </SelectInput>
        </Field>

        <Field label="Target date" className="mt-2.5">
          <TextInput
            type="date"
            value={state.stats.targetDate}
            onChange={(e) => save({ ...state, stats: { ...state.stats, targetDate: e.target.value } })}
          />
        </Field>
      </Section>

      <Section title="Calorie deficit">
        <Field label="Deficit below TDEE (%)">
          <TextInput
            type="number"
            step="1"
            min={0}
            max={100}
            value={state.settings.deficitPct}
            onChange={(e) => save({ ...state, settings: { ...state.settings, deficitPct: num(e.target.value) } })}
          />
          <p className="mt-1 text-[11px] leading-snug text-ink-3">
            10-15% is a sensible recomp range. Higher cuts faster but risks muscle loss.
          </p>
        </Field>
      </Section>

      <Section title="Protein">
        <Field label="Protein target (g per kg bodyweight)">
          <TextInput
            type="number"
            step="0.1"
            min={1.6}
            max={2.2}
            value={state.settings.proteinPerKg}
            onChange={(e) => save({ ...state, settings: { ...state.settings, proteinPerKg: num(e.target.value) } })}
          />
          <p className="mt-1 text-[11px] leading-snug text-ink-3">
            1.6-2.2 g/kg covers most recomp/cut goals; 2.0 g/kg is a safe default.
          </p>
        </Field>
      </Section>

      <PrimaryButton onClick={onClose} className="mt-2 w-full">
        Done
      </PrimaryButton>
    </Modal>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <h4 className="mb-2 font-mono text-[11px] font-extrabold uppercase tracking-[0.14em] text-ink-3">
        {title}
      </h4>
      {children}
    </div>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col gap-1.5 ${className || ''}`}>
      <label className="text-[11px] font-bold uppercase tracking-[0.06em] text-ink-3">{label}</label>
      {children}
    </div>
  );
}
