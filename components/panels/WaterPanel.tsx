'use client';

// Water panel — port of po-water.html. Same `po_water_v1` state: personalized
// daily target (weight, activity, caffeine, meds/stims), quick +/- logging,
// healthy-zone bar, why-breakdown, 14-day chart, 7-day history, settings.

import * as React from 'react';
import { ChevronDown, Minus, Settings2, X } from 'lucide-react';
import type { BentoAccent } from '@/components/ui/aurora-bento-grid';
import { storeSet, storeRemove, useStorageTick } from '@/lib/storage';
import { calendarDateKey, dateToKey } from '@/lib/dates';
import {
  WATER_KEY,
  SUBSTANCE_DB,
  computeTargetMl,
  fmtMl,
  loadWaterState,
  normalizeWaterState,
  subDoseLabel,
  subExtraMl,
  targetUnits,
  unitLabelPlural,
  unitLabelSingular,
  type WaterState,
} from '@/lib/water';
import {
  Card,
  DangerGhostButton,
  Eyebrow,
  GhostButton,
  Modal,
  PrimaryButton,
  Seg,
  TextInput,
} from './shared';

export default function WaterPanel({ accent }: { accent: BentoAccent }) {
  const tick = useStorageTick();
  const state = React.useMemo(() => loadWaterState(), [tick]);
  const [whyOpen, setWhyOpen] = React.useState(false);
  const [settingsOpen, setSettingsOpen] = React.useState(false);

  const save = (next: WaterState) => storeSet(WATER_KEY, next);

  const calc = computeTargetMl(state);
  const target = targetUnits(state);
  const count = state.logs[calendarDateKey()] || 0;
  const pctRaw = (count / target) * 100;
  const fillPct = Math.min(150, pctRaw) / 1.5;

  const setToday = (n: number) => {
    const logs = { ...state.logs };
    const k = calendarDateKey();
    if (n <= 0) delete logs[k];
    else logs[k] = n;
    save({ ...state, logs });
  };

  const helper =
    count === 0
      ? { text: 'Start the day — first one in.', good: false }
      : pctRaw < 50
        ? { text: 'Behind pace — drink one in the next hour.', good: false }
        : pctRaw < 100
          ? { text: `${target - count} to go. Pacing well.`, good: false }
          : pctRaw < 130
            ? { text: '✓ Target hit — top up if you train this evening.', good: true }
            : { text: 'Strong — way past target.', good: true };

  // last 14 days for chart, last 6 (excluding today) for history rows
  const chartDays: { key: string; count: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const k = dateToKey(d);
    chartDays.push({ key: k, count: state.logs[k] || 0 });
  }
  const histDays: { date: Date; count: number }[] = [];
  for (let i = 6; i >= 1; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    histDays.push({ date: d, count: state.logs[dateToKey(d)] || 0 });
  }

  return (
    <div className="flex flex-col gap-4 pb-2 pt-2">
      {/* hero */}
      <Card>
        <div className="flex items-start justify-between gap-3">
          <div>
            <Eyebrow className="mb-2">{unitLabelPlural(state).toUpperCase()} DRANK TODAY</Eyebrow>
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-[54px] font-bold leading-none tracking-tight text-ink tabular-nums">
                {count}
              </span>
              <span className="text-[18px] font-medium text-ink-3">/ {target}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            aria-label="Settings"
            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-[10px] border border-white/[0.07] bg-white/[0.04] text-ink-2 transition-colors hover:bg-white/[0.08] hover:text-ink"
          >
            <Settings2 size={16} aria-hidden />
          </button>
        </div>

        {/* zone bar: 0–150% with healthy band markers at 65% and 100% */}
        <div className="mb-5 mt-3.5">
          <div className="relative h-7 overflow-hidden rounded-[14px] bg-white/[0.04]">
            <div
              className="absolute bottom-0 left-0 top-0 rounded-[14px] transition-[width] duration-400"
              style={{
                width: `${fillPct}%`,
                background:
                  pctRaw > 100
                    ? `linear-gradient(90deg, ${accent.to}, #F2C063)`
                    : `linear-gradient(90deg, ${accent.from}, ${accent.to})`,
                boxShadow: `0 0 18px ${accent.from}30`,
              }}
            />
            <span className="absolute bottom-0 top-0 w-px bg-white/[0.18]" style={{ left: `${65 / 1.5}%` }} />
            <span className="absolute bottom-0 top-0 w-px bg-white/[0.18]" style={{ left: `${100 / 1.5}%` }} />
          </div>
          <div className="mt-1.5 flex justify-between font-mono text-[10px] text-ink-3">
            <span>0</span>
            <span className="font-bold lowercase tracking-[0.1em]" style={{ color: accent.text }}>
              healthy zone
            </span>
            <span>{Math.ceil(target * 1.5)}+</span>
          </div>
        </div>

        <div className="grid grid-cols-[56px_1fr] items-stretch gap-2.5">
          <button
            type="button"
            onClick={() => setToday(Math.max(0, count - 1))}
            disabled={count <= 0}
            aria-label="Undo last"
            className="flex cursor-pointer items-center justify-center rounded-2xl bg-white/[0.06] text-ink transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-30"
          >
            <Minus size={20} aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => setToday(count + 1)}
            className="flex cursor-pointer items-center justify-center gap-2 rounded-2xl bg-gradient-to-b from-white to-[#e8e5dd] p-4 text-[16px] font-bold text-[#0a0a0b] shadow-[inset_0_1px_0_rgba(255,255,255,0.55),0_4px_14px_rgba(0,0,0,0.4)] transition-transform hover:-translate-y-px active:scale-[0.98]"
          >
            Drank a {unitLabelSingular(state)} <span aria-hidden>↑</span>
          </button>
        </div>
        <div className={`mt-3 text-center text-[12px] ${helper.good ? 'text-good' : 'italic text-ink-3'}`}>
          {helper.text}
        </div>

        {/* why this target */}
        <button
          type="button"
          onClick={() => setWhyOpen(!whyOpen)}
          aria-expanded={whyOpen}
          className="mt-3.5 flex w-full cursor-pointer items-center justify-between rounded-[10px] border border-white/[0.07] px-3.5 py-2.5 text-[12px] font-semibold tracking-[0.04em] text-ink-2 transition-colors hover:bg-white/[0.04] hover:text-ink"
        >
          <span>Why this target?</span>
          <ChevronDown size={14} className={`transition-transform ${whyOpen ? 'rotate-180' : ''}`} aria-hidden />
        </button>
        {whyOpen && (
          <div className="mt-2 rounded-[10px] border border-white/[0.07] bg-white/[0.025] px-4 py-3.5">
            <WhyRow label={`Base (${state.profile.weightKg.toFixed(0)} ${state.weightUnit} × 35 ml)`} val={fmtMl(calc.base)} />
            {calc.exercise > 0 && (
              <WhyRow label={`+ Exercise (${state.profile.activityHrsPerWeek} h/wk)`} val={`+ ${fmtMl(calc.exercise)}`} />
            )}
            {calc.caffeine > 0 && (
              <WhyRow label={`+ Caffeine (${state.caffeineMgPerDay} mg/day)`} val={`+ ${fmtMl(calc.caffeine)}`} />
            )}
            {state.substances.map((s, i) => (
              <WhyRow key={i} label={`+ ${s.name} (${subDoseLabel(s)})`} val={`+ ${fmtMl(subExtraMl(s))}`} />
            ))}
            {calc.adjust > 0 && <WhyRow label="+ Sex / age adjustment" val={`+ ${fmtMl(calc.adjust)}`} />}
            <div className="mt-2 flex items-baseline justify-between border-t border-white/[0.07] pt-2.5 text-[13px] tabular-nums">
              <span className="font-bold text-good">Daily target</span>
              <span className="font-mono font-semibold text-good">
                {fmtMl(calc.total)} ≈ {target} {unitLabelPlural(state)}
              </span>
            </div>
          </div>
        )}
      </Card>

      {/* history */}
      <Card>
        <Eyebrow className="mb-3">LAST 14 DAYS</Eyebrow>
        <WaterChart days={chartDays} target={target} accent={accent} />
        <div className="mt-3.5">
          {histDays.every((d) => d.count === 0) ? (
            <div className="py-3 text-center text-[12px] text-ink-3">No logs yet.</div>
          ) : (
            histDays.map(({ date, count: c }) => {
              const dows = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
              const pct = Math.min(100, (c / target) * 100);
              const miss = c < target;
              return (
                <div
                  key={date.toISOString()}
                  className="grid grid-cols-[70px_1fr_auto] items-center gap-2.5 border-b border-white/[0.06] py-2.5 text-[13px] last:border-b-0"
                >
                  <span className="font-mono text-[11px] text-ink-3">
                    {dows[date.getDay()]} {date.getMonth() + 1}/{date.getDate()}
                  </span>
                  <div className="h-2 overflow-hidden rounded bg-white/[0.04]">
                    <div
                      className="h-full rounded"
                      style={{
                        width: `${pct}%`,
                        background: miss ? 'rgba(255,138,138,0.4)' : `linear-gradient(90deg, ${accent.from}, ${accent.to})`,
                      }}
                    />
                  </div>
                  <span className="font-mono text-[12px] tabular-nums text-ink-2">
                    {c}/{target}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </Card>

      <WaterSettings
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        state={state}
        save={save}
      />
    </div>
  );
}

function WhyRow({ label, val }: { label: string; val: string }) {
  return (
    <div className="flex items-baseline justify-between py-1 text-[13px] tabular-nums">
      <span className="text-ink-2">{label}</span>
      <span className="font-mono font-semibold text-ink">{val}</span>
    </div>
  );
}

function WaterChart({
  days,
  target,
  accent,
}: {
  days: { key: string; count: number }[];
  target: number;
  accent: BentoAccent;
}) {
  const W = 280;
  const H = 70;
  const pad = 4;
  const maxVal = Math.max(target, ...days.map((d) => d.count)) || 1;
  const colW = (W - pad * 2) / days.length;
  const barW = colW * 0.7;
  const targetY = H - pad - (target / maxVal) * (H - pad * 2);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block h-[70px] w-full" aria-hidden>
      <line
        x1="0"
        x2={W}
        y1={targetY}
        y2={targetY}
        stroke="rgba(255,255,255,0.2)"
        strokeWidth="1"
        strokeDasharray="3 3"
        vectorEffect="non-scaling-stroke"
      />
      {days.map((d, i) => {
        const h = (d.count / maxVal) * (H - pad * 2);
        return (
          <rect
            key={d.key}
            x={pad + i * colW + (colW - barW) / 2}
            y={H - pad - h}
            width={barW}
            height={Math.max(0, h)}
            rx="2"
            fill={d.count >= target ? accent.from : 'rgba(255,138,138,0.5)'}
          />
        );
      })}
    </svg>
  );
}

// ---- settings ---------------------------------------------------------------
function WaterSettings({
  open,
  onClose,
  state,
  save,
}: {
  open: boolean;
  onClose: () => void;
  state: WaterState;
  save: (s: WaterState) => void;
}) {
  const [query, setQuery] = React.useState('');
  const fileRef = React.useRef<HTMLInputElement>(null);

  const matches = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return SUBSTANCE_DB.filter(
      (s) => s.name.toLowerCase().includes(q) || s.cat.toLowerCase().includes(q),
    ).slice(0, 8);
  }, [query]);

  const num = (v: string) => parseFloat(v) || 0;

  return (
    <Modal open={open} onClose={onClose} title="Settings" maxWidth={480}>
      <Section title="Profile">
        <div className="grid grid-cols-2 gap-2.5">
          <Field label="Weight">
            <TextInput
              type="number"
              step="0.5"
              value={state.profile.weightKg}
              onChange={(e) => save({ ...state, profile: { ...state.profile, weightKg: num(e.target.value) } })}
            />
          </Field>
          <Field label="Weight unit">
            <Seg
              options={[
                { value: 'kg', label: 'kg' },
                { value: 'lb', label: 'lb' },
              ]}
              value={state.weightUnit}
              onChange={(v) => save({ ...state, weightUnit: v })}
            />
          </Field>
          <Field label="Age">
            <TextInput
              type="number"
              value={state.profile.age}
              onChange={(e) => save({ ...state, profile: { ...state.profile, age: num(e.target.value) } })}
            />
          </Field>
          <Field label="Sex">
            <Seg
              options={[
                { value: 'm', label: 'Male' },
                { value: 'f', label: 'Female' },
                { value: 'o', label: 'Other' },
              ]}
              value={state.profile.sex}
              onChange={(v) => save({ ...state, profile: { ...state.profile, sex: v } })}
            />
          </Field>
        </div>
        <Field label="Activity (training hours per week)" className="mt-2.5">
          <TextInput
            type="number"
            step="0.5"
            value={state.profile.activityHrsPerWeek}
            onChange={(e) =>
              save({ ...state, profile: { ...state.profile, activityHrsPerWeek: num(e.target.value) } })
            }
          />
        </Field>
      </Section>

      <Section title="Display">
        <Field label="Show water as">
          <Seg
            options={[
              { value: 'bottle', label: 'Bottles' },
              { value: 'glass', label: 'Glasses' },
              { value: 'oz', label: 'oz' },
              { value: 'ml', label: 'ml' },
            ]}
            value={state.unit}
            onChange={(v) => save({ ...state, unit: v })}
          />
        </Field>
        <div className="mt-2.5 grid grid-cols-2 gap-2.5">
          <Field label="Bottle size (ml)">
            <TextInput
              type="number"
              step="50"
              value={state.bottleMl}
              onChange={(e) => save({ ...state, bottleMl: num(e.target.value) || 500 })}
            />
          </Field>
          <Field label="Glass size (ml)">
            <TextInput
              type="number"
              step="10"
              value={state.glassMl}
              onChange={(e) => save({ ...state, glassMl: num(e.target.value) || 250 })}
            />
          </Field>
        </div>
      </Section>

      <Section title="Caffeine">
        <Field label="Average caffeine per day (mg)">
          <TextInput
            type="number"
            step="10"
            value={state.caffeineMgPerDay}
            onChange={(e) => save({ ...state, caffeineMgPerDay: num(e.target.value) })}
          />
          <p className="mt-1 text-[11px] leading-snug text-ink-3">
            ~1 cup of coffee = 95mg · espresso shot = 75mg · energy drink = 160mg. Above 200mg/day starts to
            add a small water requirement.
          </p>
        </Field>
      </Section>

      <Section title="Stimulants & meds">
        <Field label="Search to add">
          <div className="relative">
            <TextInput
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Type a name (Adderall, Concerta, Lithium…)"
              autoComplete="off"
              className="w-full"
            />
            {matches.length > 0 && (
              <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-30 max-h-60 overflow-y-auto rounded-[10px] border border-white/[0.14] bg-[#141416] p-1">
                {matches.map((s) => {
                  const already = state.substances.some((x) => x.id === s.id);
                  return (
                    <button
                      key={s.id}
                      type="button"
                      disabled={already}
                      onClick={() => {
                        save({
                          ...state,
                          substances: [
                            ...state.substances,
                            { id: s.id, name: s.name, cat: s.cat, unit: s.unit, mlPerUnit: s.mlPerUnit, defaultDose: s.defaultDose, dose: s.defaultDose },
                          ],
                        });
                        setQuery('');
                      }}
                      className="flex w-full cursor-pointer flex-col gap-0.5 rounded-lg px-3 py-2 text-left transition-colors hover:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <span className="text-[13px] font-semibold text-ink">
                        {s.name} <span className="text-good">{already ? '· added' : '+'}</span>
                      </span>
                      <span className="font-mono text-[10.5px] text-ink-3">
                        {s.cat} · {s.defaultDose} {s.unit} default → adds ~{fmtMl((s.defaultDose || 0) * (s.mlPerUnit || 0))}/day · {s.note}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <p className="mt-1 text-[11px] leading-snug text-ink-3">
            Each substance bumps your daily water target. Includes ADHD stims, diuretics, decongestants,
            nicotine, alcohol, and a few others.
          </p>
        </Field>
        <div className="mt-2.5 flex flex-col gap-1.5">
          {state.substances.length === 0 ? (
            <div className="py-3 text-center text-[12px] italic text-ink-3">No substances added.</div>
          ) : (
            state.substances.map((s, i) => (
              <div
                key={`${s.id}-${i}`}
                className="flex flex-wrap items-center gap-2.5 rounded-[10px] border border-white/[0.07] bg-white/[0.025] px-3 py-2.5"
              >
                <div className="min-w-[140px] flex-1">
                  <div className="text-[13px] font-semibold text-ink">{s.name}</div>
                  <div className="mt-0.5 font-mono text-[11px] tabular-nums text-ink-3">
                    + {fmtMl(subExtraMl(s))} / day · {s.cat}
                  </div>
                </div>
                <div className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.07] bg-black/30 px-2 py-1">
                  <input
                    type="number"
                    min={0}
                    step={0.5}
                    value={s.dose != null ? s.dose : s.defaultDose}
                    onChange={(e) => {
                      const subs = state.substances.slice();
                      subs[i] = { ...subs[i], dose: parseFloat(e.target.value) || 0 };
                      save({ ...state, substances: subs });
                    }}
                    className="w-14 bg-transparent text-center font-mono text-[13px] font-semibold text-ink tabular-nums outline-none"
                  />
                  <span className="whitespace-nowrap font-mono text-[11px] text-ink-3">{s.unit}</span>
                </div>
                <button
                  type="button"
                  onClick={() => save({ ...state, substances: state.substances.filter((_, j) => j !== i) })}
                  aria-label="Remove"
                  className="cursor-pointer px-1.5 text-ink-4 transition-colors hover:text-bad"
                >
                  <X size={15} aria-hidden />
                </button>
              </div>
            ))
          )}
        </div>
      </Section>

      <Section title="Data">
        <div className="flex flex-wrap gap-2">
          <GhostButton
            onClick={() => {
              const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `water-coach-data-${new Date().toISOString().slice(0, 10)}.json`;
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            Export JSON
          </GhostButton>
          <GhostButton onClick={() => fileRef.current?.click()}>Import JSON</GhostButton>
          <DangerGhostButton
            onClick={() => {
              if (!window.confirm('Wipe ALL water logs and settings? This cannot be undone.')) return;
              storeRemove(WATER_KEY);
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
              const f = e.target.files?.[0];
              if (!f) return;
              const r = new FileReader();
              r.onload = () => {
                try {
                  const parsed = JSON.parse(String(r.result));
                  if (!window.confirm('Replace ALL current data with the imported file?')) return;
                  save(normalizeWaterState(parsed));
                } catch (err) {
                  alert(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
                }
              };
              r.readAsText(f);
              e.target.value = '';
            }}
          />
        </div>
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
