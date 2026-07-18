'use client';

import * as React from 'react';
import dynamic from 'next/dynamic';
import { useRouter, useSearchParams } from 'next/navigation';
import { MotionConfig, motion } from 'motion/react';
import { Target, Pill, Droplets, Dumbbell, Wallet, Apple, GraduationCap, Plus, type LucideIcon } from 'lucide-react';
import {
  AuroraBackground,
  BentoGrid,
  BentoGridItem,
  BentoExpandedOverlay,
  AnimatePresence,
  type BentoAccent,
} from '@/components/ui/aurora-bento-grid';
import { MiniRing, MiniSegBar, MiniWeekBars, MiniSparkline } from '@/components/dashboard/mini-viz';
import { initCloudSync } from '@/lib/cloud-sync';
import { storeGet, storeSet, useStorageTick } from '@/lib/storage';
import { activeDateKey, calendarDateKey, dateToKey, tomorrowDateKey, todayLabelUpper } from '@/lib/dates';
import { loadWaterState, targetUnits } from '@/lib/water';
import { loadPoState, todaySplit, isRestName } from '@/lib/gym';
import { ensureRates, fmtMoney } from '@/lib/fx';
import { loadNutritionState, resolveTargets } from '@/lib/nutrition';
import { loadCachedEnergy, recentClosedBurns, refreshWhoopEnergy } from '@/lib/whoop';
import { entriesFor, loadFoodLog, progress, totalsFor } from '@/lib/food';
import { CFA_READINGS, daysUntilExam, doneCount, loadCfaProgress, pctComplete } from '@/lib/cfa';

const GoalsPanel = dynamic(() => import('@/components/panels/GoalsPanel'), { ssr: false });
const StackPanel = dynamic(() => import('@/components/panels/StackPanel'), { ssr: false });
const WaterPanel = dynamic(() => import('@/components/panels/WaterPanel'), { ssr: false });
const GymPanel = dynamic(() => import('@/components/panels/GymPanel'), { ssr: false });
const FinancePanel = dynamic(() => import('@/components/panels/FinancePanel'), { ssr: false });
const NutritionPanel = dynamic(() => import('@/components/panels/NutritionPanel'), { ssr: false });
const ProjectsPanel = dynamic(() => import('@/components/panels/ProjectsPanel'), { ssr: false });

type PanelId = 'goals' | 'stack' | 'water' | 'gym' | 'finance' | 'nutrition' | 'projects';

// Finance is fully built and kept intact (component, data layer, stored data)
// but not currently used — hidden via this flag rather than deleted, commented
// out, or CSS-hidden (which would still mount it and run its fetches).
// Restoring it later: remove 'finance' from this set and swap the grid tile
// back (see the bento grid section below).
const HIDDEN_PANELS = new Set<PanelId>(['finance']);

const PANELS: Record<
  PanelId,
  { title: string; icon: LucideIcon; accent: BentoAccent; maxWidth: number }
> = {
  goals: {
    title: 'Goals',
    icon: Target,
    accent: { from: '#A78BFA', to: '#E879F9', text: '#C4B5FD' },
    maxWidth: 780,
  },
  stack: {
    title: 'Stack',
    icon: Pill,
    accent: { from: '#FBBF24', to: '#FB923C', text: '#FCD34D' },
    maxWidth: 780,
  },
  water: {
    title: 'Water',
    icon: Droplets,
    accent: { from: '#22D3EE', to: '#3B82F6', text: '#67E8F9' },
    maxWidth: 720,
  },
  gym: {
    title: 'Gym',
    icon: Dumbbell,
    accent: { from: '#34D399', to: '#A3E635', text: '#6EE7B7' },
    maxWidth: 780,
  },
  finance: {
    title: 'Finance',
    icon: Wallet,
    accent: { from: '#FB7185', to: '#EF4444', text: '#FDA4AF' },
    maxWidth: 900,
  },
  nutrition: {
    title: 'Nutrition',
    icon: Apple,
    accent: { from: '#FDBA74', to: '#FB7185', text: '#FDBA74' },
    maxWidth: 720,
  },
  projects: {
    title: 'Projects',
    icon: GraduationCap,
    // Own indigo/blue accent — deliberately not Finance's rose/red, so
    // restoring Finance later doesn't collide with this box's colour.
    accent: { from: '#6366F1', to: '#3B82F6', text: '#A5B4FC' },
    maxWidth: 820,
  },
};

const PANEL_IDS = Object.keys(PANELS) as PanelId[];

type Goal = { text: string; done: boolean; queued?: boolean };

function useMounted() {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  return mounted;
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return 'Late night';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export default function Page() {
  return (
    <React.Suspense fallback={null}>
      <Dashboard />
    </React.Suspense>
  );
}

function Dashboard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const mounted = useMounted();
  const tick = useStorageTick();

  React.useEffect(() => {
    initCloudSync();
    ensureRates();
    // Warms the shared burn cache so the Nutrition card shows the WHOOP-driven
    // target without having to open the panel first. No-ops when not connected.
    refreshWhoopEnergy().catch(() => {});
  }, []);

  const raw = searchParams.get('p');
  const openId: PanelId | null =
    PANEL_IDS.includes(raw as PanelId) && !HIDDEN_PANELS.has(raw as PanelId) ? (raw as PanelId) : null;

  const open = React.useCallback(
    (id: PanelId) => router.push(`/?p=${id}`, { scroll: false }),
    [router],
  );
  const close = React.useCallback(() => router.push('/', { scroll: false }), [router]);

  // ---- collapsed-card metrics (same localStorage the panels write) --------
  const m = React.useMemo(() => {
    if (!mounted) return null;

    const goals = (storeGet<Goal[]>(`goals:${activeDateKey()}`) || []).filter(Boolean);
    const goalsDone = goals.filter((g) => g.done).length;
    const goalsPending = goals.filter((g) => !g.done).slice(0, 4);
    const streak = storeGet<{ count: number }>('goal_streak_v1')?.count || 0;
    const tomorrowPlanned = (storeGet<Goal[]>(`goals:${tomorrowDateKey()}`) || []).length;

    const stackItems = storeGet<{ id: string }[]>('stack:items') || [];
    const taken = storeGet<Record<string, number>>(`stack:taken:${activeDateKey()}`) || {};
    const stackDone = stackItems.filter((i) => taken[i.id]).length;

    const water = loadWaterState();
    const waterCount = water.logs[calendarDateKey()] || 0;
    const waterTarget = targetUnits(water);

    const po = loadPoState();
    const split = todaySplit(po);
    const byDay: Record<string, number> = {};
    Object.values(po.logs).forEach((arr) =>
      arr.forEach((l) => {
        const dk = l.date.slice(0, 10);
        byDay[dk] = (byDay[dk] || 0) + 1;
      }),
    );
    const week: number[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      week.push(byDay[dateToKey(d)] || 0);
    }
    const setsToday = byDay[dateToKey(new Date())] || 0;

    let nw = 0;
    (['bank', 'stocks', 'crypto', 'other'] as const).forEach((k) => {
      (storeGet<{ amount: number }[]>(`nw:${k}`) || []).forEach((it) => {
        nw += Number(it.amount) || 0;
      });
    });
    const currency = storeGet<string>('nw_currency') || 'CHF';
    const hist = (storeGet<{ v: number }[]>('nw:history') || []).map((p) => p.v).slice(-30);
    const nwDelta = hist.length >= 2 ? hist[hist.length - 1] - hist[0] : 0;

    const energy = loadCachedEnergy();
    const nutrition = resolveTargets(loadNutritionState(), energy, recentClosedBurns());
    const eaten = totalsFor(entriesFor(loadFoodLog()));
    const calProg = progress(eaten.kcal, nutrition.calorie.calorieTarget);
    const proProg = progress(eaten.protein, nutrition.proteinTarget);

    const cfaProgress = loadCfaProgress();

    return {
      goals: { done: goalsDone, total: goals.length, streak, tomorrowPlanned, pending: goalsPending },
      stack: { done: stackDone, total: stackItems.length },
      water: { count: waterCount, target: waterTarget },
      gym: { split: split.name, rest: isRestName(split.name), setsToday, week },
      finance: { nw, currency, hist, nwDelta },
      nutrition: {
        cal: calProg,
        pro: proProg,
        entries: eaten.count,
        estimated: nutrition.estimated,
        whoopRaising: nutrition.whoopRaising,
        burn: energy
          ? { resting: Math.round(energy.restingKcal), training: Math.round(energy.workoutKcal) }
          : null,
      },
      projects: {
        days: daysUntilExam(),
        pct: pctComplete(cfaProgress),
        done: doneCount(cfaProgress),
        total: CFA_READINGS.length,
      },
    };
  }, [mounted, openId, tick]);

  const addWater = React.useCallback(() => {
    const s = loadWaterState();
    const k = calendarDateKey();
    s.logs = { ...s.logs, [k]: (s.logs[k] || 0) + 1 };
    storeSet('po_water_v1', s);
  }, []);

  const P = PANELS;

  return (
    <MotionConfig reducedMotion="user">
      <div className="relative">
        <AuroraBackground />
        <main className="relative z-[2] mx-auto max-w-[1060px] px-5 pb-14 pt-[max(1.75rem,env(safe-area-inset-top))]">
        {/* ===== greeting header ===== */}
        <motion.header
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="mb-6 flex flex-wrap items-end justify-between gap-4"
        >
          <div>
            <p className="font-mono text-[10.5px] font-bold uppercase tracking-[0.2em] text-ink-3">
              {todayLabelUpper()}
            </p>
            <h1 className="mt-1.5 bg-gradient-to-b from-white to-[#c7c4bc] bg-clip-text text-[28px] font-bold leading-tight tracking-tight text-transparent sm:text-[32px]">
              {greeting()}, Aamir
            </h1>
          </div>

          {/* quick-status pills — the old top bar's live counters */}
          <div className="flex items-center gap-2">
            <StatusPill
              label="GOALS"
              value={m ? `${m.goals.done}/${m.goals.total}` : '—'}
              tone={m ? classify(m.goals.done, m.goals.total) : 'idle'}
              onClick={() => open('goals')}
            />
            <StatusPill
              label="STACK"
              value={m ? `${m.stack.done}/${m.stack.total}` : '—'}
              tone={m ? classify(m.stack.done, m.stack.total) : 'idle'}
              onClick={() => open('stack')}
            />
            <div className="flex items-stretch">
              <StatusPill
                label="WATER"
                value={m ? `${m.water.count}/${m.water.target}` : '—'}
                tone={m ? classify(m.water.count, m.water.target) : 'idle'}
                onClick={() => open('water')}
                className="rounded-r-none border-r-0"
              />
              <button
                type="button"
                onClick={addWater}
                aria-label="Log one drink"
                className="flex w-9 cursor-pointer items-center justify-center rounded-r-[11px] border border-cyan-300/15 bg-gradient-to-b from-cyan-300/20 to-emerald-300/20 text-[15px] font-bold text-white transition-transform active:scale-90"
              >
                <Plus size={14} strokeWidth={3} aria-hidden />
              </button>
            </div>
          </div>
        </motion.header>

        {/* ===== bento grid ===== */}
        <BentoGrid>
          <BentoGridItem
            id="goals"
            index={0}
            title="Goals"
            icon={P.goals.icon}
            accent={P.goals.accent}
            metric={m ? `${m.goals.done}/${m.goals.total}` : '—'}
            metricSuffix="done today"
            sub={
              m && m.goals.streak > 0 ? (
                <span className="text-warn">⚡ {m.goals.streak} day streak</span>
              ) : (
                'no active streak'
              )
            }
            viz={
              <MiniSegBar
                done={m?.goals.done ?? 0}
                total={m?.goals.total ?? 0}
                color={P.goals.accent.from}
              />
            }
            body={
              <div className="hidden flex-col gap-1.5 md:flex">
                {m && m.goals.pending.length > 0 ? (
                  m.goals.pending.map((g, i) => (
                    <div
                      key={`${g.text}-${i}`}
                      className="flex items-center gap-2.5 rounded-[10px] border border-white/[0.05] bg-black/20 px-3 py-2 text-[12.5px] text-ink-2"
                    >
                      <span
                        className="h-[6px] w-[6px] shrink-0 rounded-full"
                        style={{ background: `${P.goals.accent.from}99` }}
                        aria-hidden
                      />
                      <span className="truncate">{g.text}</span>
                    </div>
                  ))
                ) : (
                  <div className="rounded-[10px] border border-dashed border-white/[0.07] px-3 py-2 text-[12px] italic text-ink-3">
                    {m && m.goals.total > 0 ? 'All done — solid day.' : 'No goals yet — tap to add one.'}
                  </div>
                )}
              </div>
            }
            expanded={openId === 'goals'}
            onOpen={() => open('goals')}
            className="md:col-span-3 md:row-span-2"
          />
          <BentoGridItem
            id="stack"
            index={1}
            title="Stack"
            icon={P.stack.icon}
            accent={P.stack.accent}
            metric={m ? `${m.stack.done}/${m.stack.total}` : '—'}
            metricSuffix="taken"
            sub="resets at 6 AM"
            viz={
              <MiniSegBar
                done={m?.stack.done ?? 0}
                total={m?.stack.total ?? 0}
                color={P.stack.accent.from}
              />
            }
            expanded={openId === 'stack'}
            onOpen={() => open('stack')}
            className="md:col-span-3"
          />
          <BentoGridItem
            id="water"
            index={2}
            title="Water"
            icon={P.water.icon}
            accent={P.water.accent}
            metric={m ? String(m.water.count) : '—'}
            metricSuffix={m ? `/ ${m.water.target}` : undefined}
            sub={
              m
                ? m.water.count >= m.water.target
                  ? '✓ target hit'
                  : `${m.water.target - m.water.count} to go`
                : undefined
            }
            viz={
              <MiniRing
                value={m?.water.count ?? 0}
                max={m?.water.target ?? 1}
                color={P.water.accent.from}
              />
            }
            expanded={openId === 'water'}
            onOpen={() => open('water')}
            className="md:col-span-3"
          />
          <BentoGridItem
            id="gym"
            index={3}
            title="Gym"
            icon={P.gym.icon}
            accent={P.gym.accent}
            metric={m ? (m.gym.rest ? 'REST' : m.gym.split.toUpperCase()) : '—'}
            sub={
              m
                ? m.gym.setsToday > 0
                  ? `${m.gym.setsToday} sets logged today`
                  : 'no sets logged yet'
                : undefined
            }
            viz={<MiniWeekBars values={m?.gym.week ?? [0, 0, 0, 0, 0, 0, 0]} color={P.gym.accent.from} />}
            expanded={openId === 'gym'}
            onOpen={() => open('gym')}
            className="md:col-span-3"
          />
          <BentoGridItem
            id="projects"
            index={4}
            title="Projects"
            icon={P.projects.icon}
            accent={P.projects.accent}
            metric={m ? `${m.projects.days}d · ${m.projects.pct}%` : '—'}
            sub={m ? `${m.projects.done}/${m.projects.total} CFA readings done` : undefined}
            viz={
              <MiniRing
                value={m?.projects.done ?? 0}
                max={m?.projects.total ?? 1}
                color={P.projects.accent.from}
              />
            }
            expanded={openId === 'projects'}
            onOpen={() => open('projects')}
            className="md:col-span-3"
          />
          <BentoGridItem
            id="nutrition"
            index={5}
            title="Nutrition"
            icon={P.nutrition.icon}
            accent={P.nutrition.accent}
            metric={m ? Math.round(m.nutrition.cal.consumed).toLocaleString() : '—'}
            metricSuffix={m ? `/ ${Math.round(m.nutrition.cal.target).toLocaleString()} kcal` : undefined}
            sub={
              m ? (
                m.nutrition.cal.over ? (
                  <span className="text-warn">
                    {Math.round(m.nutrition.cal.consumed - m.nutrition.cal.target).toLocaleString()} kcal over
                    {' · '}
                    {Math.round(m.nutrition.pro.remaining)}g protein left
                  </span>
                ) : (
                  `${Math.round(m.nutrition.cal.remaining).toLocaleString()} kcal · ${Math.round(m.nutrition.pro.remaining)}g protein left today`
                )
              ) : undefined
            }
            viz={
              <MiniRing
                value={m?.nutrition.cal.consumed ?? 0}
                max={m?.nutrition.cal.target ?? 1}
                color={P.nutrition.accent.from}
              />
            }
            body={
              <div className="flex flex-col gap-2.5">
                <CardBar
                  label="CAL"
                  pct={m?.nutrition.cal.pct ?? 0}
                  over={!!m?.nutrition.cal.over}
                  gradient={`linear-gradient(90deg, ${P.nutrition.accent.from}, ${P.nutrition.accent.to})`}
                  right={
                    m
                      ? `${Math.round(m.nutrition.cal.consumed).toLocaleString()}/${Math.round(m.nutrition.cal.target).toLocaleString()}`
                      : '—'
                  }
                />
                <CardBar
                  label="PRO"
                  pct={m?.nutrition.pro.pct ?? 0}
                  over={!!m?.nutrition.pro.over}
                  gradient="linear-gradient(90deg, #E8E5DD, #B8B6B0)"
                  right={
                    m
                      ? `${Math.round(m.nutrition.pro.consumed)}/${Math.round(m.nutrition.pro.target)}g`
                      : '—'
                  }
                />
                {/* why the target moved — WHOOP resting vs training burn */}
                {m?.nutrition.burn && (
                  <div className="mt-0.5 flex items-center gap-2 font-mono text-[10px] text-ink-3">
                    <span className="inline-flex items-center gap-1">
                      <span
                        className="h-1.5 w-1.5 rounded-[2px]"
                        style={{ background: `${P.nutrition.accent.from}88` }}
                        aria-hidden
                      />
                      {m.nutrition.burn.resting.toLocaleString()} rest
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <span
                        className="h-1.5 w-1.5 rounded-[2px]"
                        style={{ background: P.nutrition.accent.to }}
                        aria-hidden
                      />
                      {m.nutrition.burn.training.toLocaleString()} train
                    </span>
                    <span className="text-ink-4">
                      burn{m.nutrition.estimated ? ' (est.)' : ''}
                    </span>
                  </div>
                )}
              </div>
            }
            expanded={openId === 'nutrition'}
            onOpen={() => open('nutrition')}
            className="md:col-span-6"
          />
        </BentoGrid>

        {/* ===== CTA banner ===== */}
        <motion.section
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className="bento-shine relative mt-3.5 overflow-hidden rounded-3xl px-6 py-6 sm:px-8"
          style={{
            background:
              'linear-gradient(120deg, rgba(167,139,250,0.16) 0%, rgba(232,121,249,0.10) 38%, rgba(224,118,88,0.14) 100%)',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08), 0 12px 40px rgba(0,0,0,0.45)',
          }}
        >
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-[19px] font-bold tracking-tight text-ink">Reset &amp; plan tomorrow</h2>
              <p className="mt-1 text-[12.5px] text-ink-2">
                {m && m.goals.tomorrowPlanned > 0
                  ? `${m.goals.tomorrowPlanned} goal${m.goals.tomorrowPlanned === 1 ? '' : 's'} queued for tomorrow — locked until 6 AM.`
                  : 'Write tomorrow’s goals tonight; they unlock at 6 AM.'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => open('goals')}
              className="cursor-pointer rounded-full bg-gradient-to-b from-white to-[#e8e5dd] px-5 py-2.5 text-[13px] font-bold text-[#0a0a0b] shadow-[inset_0_1px_0_rgba(255,255,255,0.6),0_6px_20px_rgba(0,0,0,0.45)] transition-transform hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98]"
            >
              Plan tomorrow →
            </button>
          </div>

          {/* End-of-day nutrition wrap-up. Only worth showing once something was
              actually logged — an all-zero scorecard is noise, not a summary. */}
          {m && m.nutrition.entries > 0 && (
            <div className="mt-5 border-t border-white/[0.09] pt-4">
              <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
                <div className="flex flex-wrap gap-x-6 gap-y-3">
                  <DayScore
                    label="CALORIES"
                    consumed={m.nutrition.cal.consumed}
                    target={m.nutrition.cal.target}
                    unit="kcal"
                    color={P.nutrition.accent.from}
                  />
                  <DayScore
                    label="PROTEIN"
                    consumed={m.nutrition.pro.consumed}
                    target={m.nutrition.pro.target}
                    unit="g"
                    color="#E8E5DD"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => open('nutrition')}
                  className="cursor-pointer rounded-full border border-white/[0.12] bg-white/[0.05] px-4 py-2 text-[12px] font-semibold text-ink-2 transition-colors hover:bg-white/[0.1] hover:text-ink"
                >
                  Review food log →
                </button>
              </div>
              <p className="mt-3 text-[12px] text-ink-3">{dayVerdict(m.nutrition)}</p>
            </div>
          )}
        </motion.section>
        </main>
      </div>

      {/* ===== expand-in-place overlay ===== */}
      <AnimatePresence>
        {openId && (
          <BentoExpandedOverlay
            key={openId}
            id={openId}
            title={PANELS[openId].title}
            icon={PANELS[openId].icon}
            accent={PANELS[openId].accent}
            maxWidth={PANELS[openId].maxWidth}
            onClose={close}
          >
            {openId === 'goals' && <GoalsPanel accent={PANELS.goals.accent} />}
            {openId === 'stack' && <StackPanel accent={PANELS.stack.accent} />}
            {openId === 'water' && <WaterPanel accent={PANELS.water.accent} />}
            {openId === 'gym' && <GymPanel accent={PANELS.gym.accent} />}
            {openId === 'finance' && <FinancePanel accent={PANELS.finance.accent} />}
            {openId === 'nutrition' && <NutritionPanel accent={PANELS.nutrition.accent} />}
            {openId === 'projects' && <ProjectsPanel accent={PANELS.projects.accent} />}
          </BentoExpandedOverlay>
        )}
      </AnimatePresence>
    </MotionConfig>
  );
}

/** One macro's end-of-day score: consumed / target and % of target hit. */
function DayScore({
  label,
  consumed,
  target,
  unit,
  color,
}: {
  label: string;
  consumed: number;
  target: number;
  unit: string;
  color: string;
}) {
  const pct = target > 0 ? Math.round((consumed / target) * 100) : 0;
  const over = consumed > target;
  return (
    <div>
      <div className="font-mono text-[9.5px] font-bold uppercase tracking-[0.16em] text-ink-4">
        {label}
      </div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span
          className="font-mono text-[20px] font-bold leading-none tabular-nums"
          style={{ color: over ? '#F2C063' : color }}
        >
          {pct}%
        </span>
        <span className="font-mono text-[11px] tabular-nums text-ink-3">
          {Math.round(consumed).toLocaleString()} / {Math.round(target).toLocaleString()} {unit}
        </span>
      </div>
    </div>
  );
}

/** Plain-language read on the day. Protein under-shoot matters more than a small
 *  calorie under-shoot on a recomp, so it's called out first. */
function dayVerdict(n: {
  cal: { consumed: number; target: number; over: boolean };
  pro: { consumed: number; target: number; over: boolean };
}): string {
  const calPct = n.cal.target > 0 ? (n.cal.consumed / n.cal.target) * 100 : 0;
  const proPct = n.pro.target > 0 ? (n.pro.consumed / n.pro.target) * 100 : 0;
  const proteinShort = Math.round(n.pro.target - n.pro.consumed);

  if (proPct < 80) {
    return `Protein is ${proteinShort}g short — the one worth topping up before bed.`;
  }
  if (n.cal.over) {
    const over = Math.round(n.cal.consumed - n.cal.target);
    return `${over.toLocaleString()} kcal over target, protein hit. One day won't undo the week.`;
  }
  if (calPct >= 90 && proPct >= 100) return 'Calories and protein both on target — textbook day.';
  if (proPct >= 100) return 'Protein hit, calories under target. Solid recomp day.';
  return 'On track — protein close, calories under target.';
}

/** Slim consumed-vs-target bar for the collapsed Nutrition tile. */
function CardBar({
  label,
  pct,
  over,
  gradient,
  right,
}: {
  label: string;
  pct: number;
  over: boolean;
  gradient: string;
  right: string;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="w-[26px] shrink-0 font-mono text-[9.5px] font-bold tracking-[0.1em] text-ink-4">
        {label}
      </span>
      <div className="h-[6px] flex-1 overflow-hidden rounded-full bg-white/[0.06]">
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{
            width: `${Math.max(pct, 0)}%`,
            background: over ? 'linear-gradient(90deg, #F2C063, #FF8A8A)' : gradient,
          }}
        />
      </div>
      <span
        className={`shrink-0 font-mono text-[10px] font-semibold tabular-nums ${over ? 'text-warn' : 'text-ink-3'}`}
      >
        {right}
      </span>
    </div>
  );
}

function classify(done: number, total: number): 'idle' | 'good' | 'warn' | 'miss' {
  if (total === 0) return 'idle';
  if (done >= total) return 'good';
  const h = new Date().getHours();
  if (h >= 18 && done < total * 0.5) return 'miss';
  return 'warn';
}

const TONE_DOT: Record<string, string> = {
  idle: 'bg-white/25',
  good: 'bg-good shadow-[0_0_8px_rgba(107,227,164,0.7)]',
  warn: 'bg-warn shadow-[0_0_8px_rgba(242,192,99,0.6)]',
  miss: 'bg-bad shadow-[0_0_8px_rgba(255,138,138,0.7)] animate-pulse',
};

function StatusPill({
  label,
  value,
  tone,
  onClick,
  className,
}: {
  label: string;
  value: string;
  tone: 'idle' | 'good' | 'warn' | 'miss';
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex cursor-pointer items-center gap-2 rounded-[11px] border border-white/[0.07] bg-white/[0.04] px-3 py-2 transition-colors hover:bg-white/[0.07] ${className || ''}`}
    >
      <span className={`h-[7px] w-[7px] rounded-full ${TONE_DOT[tone]}`} aria-hidden />
      <span className="hidden font-mono text-[9.5px] font-bold uppercase tracking-[0.14em] text-white/50 sm:inline">
        {label}
      </span>
      <span className="font-mono text-[12px] font-bold tabular-nums text-ink">{value}</span>
    </button>
  );
}
