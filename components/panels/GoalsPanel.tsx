'use client';

// Goals panel — functional port of the old index.html (goal ticker, day ring,
// today list with streak/queue/drag-reorder, plan-tomorrow list, 6 AM
// rollover, push-remaining). Same `goals:YYYY-MM-DD` + `goal_streak_v1` keys.

import * as React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Zap, GripVertical, X } from 'lucide-react';
import type { BentoAccent } from '@/components/ui/aurora-bento-grid';
import { storeGet, storeSet, storeRemove, storeListKeys, useStorageTick } from '@/lib/storage';
import { activeDateKey, tomorrowDateKey, formatDateKey, formatClock } from '@/lib/dates';
import { Card, EmptyState, PrimaryButton, GhostButton, TextInput, SectionTitle } from './shared';

type Goal = { text: string; done: boolean; queued?: boolean; doneAt?: number };

const WAKE_HOUR = 8;
const SLEEP_HOUR = 24;

const todayKey = () => `goals:${activeDateKey()}`;
const tomorrowKey = () => `goals:${tomorrowDateKey()}`;

function getGoals(key: string): Goal[] {
  const g = storeGet<Goal[]>(key);
  return Array.isArray(g) ? g : [];
}

// Pull undone older goals into today, drop stale day keys.
function rollover() {
  const todayDateStr = activeDateKey();
  const todayK = `goals:${todayDateStr}`;
  const today = getGoals(todayK);
  const texts = new Set(today.map((g) => g.text));
  let changed = false;
  storeListKeys('goals:').forEach((k) => {
    const dateStr = k.slice('goals:'.length);
    if (dateStr >= todayDateStr) return;
    getGoals(k).forEach((g) => {
      if (!g.done && g.text && !texts.has(g.text)) {
        today.push({ text: g.text, done: false });
        texts.add(g.text);
        changed = true;
      }
    });
    storeRemove(k);
    changed = true;
  });
  if (changed) storeSet(todayK, today);
}

function processStreak() {
  const s = storeGet<{ count: number; lastProcessedDate: string }>('goal_streak_v1') || {
    count: 0,
    lastProcessedDate: '',
  };
  const todayDateStr = activeDateKey();
  const keys = storeListKeys('goals:')
    .map((k) => k.slice('goals:'.length))
    .filter((d) => d < todayDateStr)
    .sort();
  keys.forEach((dateStr) => {
    if (s.lastProcessedDate && dateStr <= s.lastProcessedDate) return;
    const list = getGoals(`goals:${dateStr}`);
    if (list.length === 0) {
      /* empty days don't break the streak */
    } else if (list.every((g) => g.done)) s.count += 1;
    else s.count = 0;
    s.lastProcessedDate = dateStr;
  });
  storeSet('goal_streak_v1', s);
}

// ---- day ring palette (sunrise → dusk) --------------------------------------
const PALETTE: [number, [number, number, number]][] = [
  [0, [255, 216, 158]],
  [12.5, [255, 205, 121]],
  [25, [255, 227, 143]],
  [37.5, [255, 183, 106]],
  [50, [255, 149, 89]],
  [62.5, [243, 111, 79]],
  [75, [226, 93, 122]],
  [87.5, [123, 91, 176]],
  [100, [47, 58, 102]],
];
function paletteAt(p: number): string {
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  let c = PALETTE[PALETTE.length - 1][1];
  if (p <= 0) c = PALETTE[0][1];
  else if (p < 100) {
    for (let i = 0; i < PALETTE.length - 1; i++) {
      const [p0, c0] = PALETTE[i];
      const [p1, c1] = PALETTE[i + 1];
      if (p >= p0 && p <= p1) {
        const t = (p - p0) / (p1 - p0);
        c = [lerp(c0[0], c1[0], t), lerp(c0[1], c1[1], t), lerp(c0[2], c1[2], t)];
        break;
      }
    }
  }
  return `rgb(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])})`;
}

export default function GoalsPanel({ accent }: { accent: BentoAccent }) {
  const tick = useStorageTick();
  const [, forceRender] = React.useReducer((x: number) => x + 1, 0);

  React.useEffect(() => {
    rollover();
    processStreak();
    const t = setInterval(forceRender, 60 * 1000); // day ring refresh
    return () => clearInterval(t);
  }, []);

  const today = React.useMemo(() => getGoals(todayKey()), [tick]);
  const tomorrow = React.useMemo(() => getGoals(tomorrowKey()), [tick]);
  const streak = storeGet<{ count: number }>('goal_streak_v1')?.count || 0;
  const done = today.filter((g) => g.done).length;

  return (
    <div className="flex flex-col gap-4 pb-2 pt-2">
      <GoalTicker goals={today} accent={accent} />
      <DayRing />

      <SectionTitle>To do list</SectionTitle>
      <GoalListCard
        title={`Today — ${formatDateKey(activeDateKey())}`}
        storageKey={todayKey()}
        goals={today}
        readOnly={false}
        accent={accent}
        header={
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-baseline gap-1.5">
              <span className="font-mono text-[40px] font-bold leading-none tracking-tight text-ink tabular-nums">
                {done}
              </span>
              <span className="font-mono text-[17px] text-ink-3">/ {today.length}</span>
              <span className="ml-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-3">
                {today.length === 0
                  ? 'no goals yet'
                  : done === today.length
                    ? 'all done — solid day'
                    : 'complete'}
              </span>
            </div>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] ${
                streak > 0
                  ? 'border-warn/40 bg-warn/10 text-warn'
                  : 'border-white/[0.07] bg-white/[0.04] text-ink-3'
              }`}
            >
              <Zap size={12} aria-hidden /> <span className="font-mono">{streak}</span> day streak
            </span>
          </div>
        }
      />
      <GoalListCard
        title={`Plan tomorrow — ${formatDateKey(tomorrowDateKey())}`}
        subtitle="Write tonight, locked until 6 AM."
        storageKey={tomorrowKey()}
        goals={tomorrow}
        readOnly
        accent={accent}
        header={
          <div className="flex items-center justify-between">
            <span className="font-mono text-[11px] font-semibold tabular-nums text-ink-3">
              {tomorrow.length} planned
            </span>
          </div>
        }
      />
    </div>
  );
}

// ---- rotating ticker ---------------------------------------------------------
function GoalTicker({ goals, accent }: { goals: Goal[]; accent: BentoAccent }) {
  const items = React.useMemo(() => {
    if (goals.length === 0)
      return [{ status: 'empty', text: 'No goals set for today — add one to get rolling.' }];
    const pending = goals.filter((g) => !g.done);
    if (pending.length === 0) return [{ status: 'done', text: '✓ All goals done — solid day.' }];
    return pending.map((g) => ({ status: 'pending', text: g.text }));
  }, [goals]);
  const [idx, setIdx] = React.useState(0);

  React.useEffect(() => {
    setIdx(0);
    if (items.length <= 1) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % items.length), 5000);
    return () => clearInterval(t);
  }, [items]);

  const item = items[Math.min(idx, items.length - 1)];
  const doneCount = goals.filter((g) => g.done).length;

  return (
    <div
      className="relative flex items-center gap-2.5 overflow-hidden rounded-xl px-3 py-2"
      style={{
        background:
          'linear-gradient(180deg, rgba(0,0,0,0.42), rgba(0,0,0,0.30)), repeating-linear-gradient(0deg, rgba(255,255,255,0.025) 0, rgba(255,255,255,0.025) 1px, transparent 1px, transparent 3px)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
      }}
      aria-live="polite"
    >
      <span
        className="h-[7px] w-[7px] animate-pulse rounded-full"
        style={{ background: accent.from, boxShadow: `0 0 8px ${accent.from}b0` }}
        aria-hidden
      />
      <span className="font-mono text-[9.5px] font-extrabold tracking-[0.18em] text-ink-3">GOALS</span>
      <div className="relative h-[22px] min-w-0 flex-1 overflow-hidden">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={`${idx}-${item.text}`}
            initial={{ y: '100%', opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: '-100%', opacity: 0 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            className="absolute inset-0 flex items-center gap-2 whitespace-nowrap font-mono text-[12.5px] font-semibold text-ink tabular-nums"
          >
            <span className={item.status === 'done' ? 'text-good' : 'text-ink-3'}>
              {item.status === 'done' ? '✓' : item.status === 'pending' ? '○' : '·'}
            </span>
            <span className="truncate">{item.text}</span>
          </motion.div>
        </AnimatePresence>
      </div>
      <span className="rounded-full bg-white/[0.04] px-2 py-0.5 font-mono text-[11px] font-bold tabular-nums text-ink-2">
        {doneCount}/{goals.length}
      </span>
    </div>
  );
}

// ---- day ring -----------------------------------------------------------------
function DayRing() {
  const now = new Date();
  const hours = now.getHours() + now.getMinutes() / 60;
  const C = 2 * Math.PI * 52;

  let pct: number | null = null;
  let phase = 'SLEEPING';
  let status = '😴 Still sleeping';
  let remaining = '';
  let stroke = '#4D4B47';
  let offset = C;

  if (hours >= WAKE_HOUR && hours < SLEEP_HOUR) {
    const p = ((hours - WAKE_HOUR) / (SLEEP_HOUR - WAKE_HOUR)) * 100;
    pct = Math.floor(p);
    offset = C * (1 - p / 100);
    stroke = paletteAt(p);
    if (p < 25) [phase, status] = ['MORNING', '☀️ Morning — fresh start'];
    else if (p < 50) [phase, status] = ['MIDDAY', '⚡ Midday — keep moving'];
    else if (p < 75) [phase, status] = ['AFTERNOON', '🔥 Afternoon — push it'];
    else if (p < 90) [phase, status] = ['EVENING', '⏳ Evening — wrap up'];
    else [phase, status] = ['BEDTIME', '🌙 Bedtime soon'];
    const minsLeft = (SLEEP_HOUR - hours) * 60;
    remaining = `${Math.floor(minsLeft / 60)}h ${Math.floor(minsLeft % 60)}m awake time left`;
  } else if (hours >= SLEEP_HOUR) {
    pct = 100;
    offset = 0;
    stroke = '#E25D7A';
    phase = 'PAST BEDTIME';
    status = '⚠️ Past bedtime';
    remaining = 'Sleep!';
  } else {
    const minsUntil = (WAKE_HOUR - hours) * 60;
    remaining = `${Math.floor(minsUntil / 60)}h ${Math.floor(minsUntil % 60)}m until wake-up`;
  }

  return (
    <Card className="flex flex-wrap items-center justify-center gap-6 py-5">
      <div className="relative h-[150px] w-[150px] shrink-0">
        <svg viewBox="0 0 120 120" className="h-full w-full">
          <circle cx="60" cy="60" r="52" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="8" />
          <circle
            cx="60"
            cy="60"
            r="52"
            fill="none"
            stroke={stroke}
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={C}
            strokeDashoffset={offset}
            transform="rotate(-90 60 60)"
            style={{
              transition: 'stroke-dashoffset 0.7s cubic-bezier(0.22,1,0.36,1), stroke 0.7s',
              filter: `drop-shadow(0 0 6px ${stroke}66)`,
            }}
          />
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-mono text-[34px] font-extrabold leading-none tracking-tight text-ink tabular-nums">
            {pct == null ? '—' : `${pct}%`}
          </span>
          <span className="mt-1 font-mono text-[9px] font-extrabold uppercase tracking-[0.16em] text-ink-3">
            {phase}
          </span>
          <span className="mt-0.5 font-mono text-[10px] text-ink-3">{formatClock(now)}</span>
        </div>
      </div>
      <div className="flex max-w-[280px] flex-col gap-1.5">
        <span className="text-[14px] font-bold text-ink">{status}</span>
        <span className="font-mono text-[12px] text-ink-2">{remaining}</span>
        <span className="font-mono text-[11px] text-ink-3">8:00 AM – 12:00 AM</span>
      </div>
    </Card>
  );
}

// ---- goal list card ------------------------------------------------------------
function GoalListCard({
  title,
  subtitle,
  storageKey,
  goals,
  readOnly,
  accent,
  header,
}: {
  title: string;
  subtitle?: string;
  storageKey: string;
  goals: Goal[];
  readOnly: boolean;
  accent: BentoAccent;
  header: React.ReactNode;
}) {
  const [input, setInput] = React.useState('');
  const [status, setStatus] = React.useState<{ msg: string; error?: boolean } | null>(null);
  const [expanded, setExpanded] = React.useState(false);
  const [dragIdx, setDragIdx] = React.useState<number | null>(null);
  const [overIdx, setOverIdx] = React.useState<number | null>(null);
  const statusTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const save = (list: Goal[]) => storeSet(storageKey, list);

  const showStatus = (msg: string, error = false) => {
    setStatus({ msg, error });
    clearTimeout(statusTimer.current);
    statusTimer.current = setTimeout(() => setStatus(null), 3500);
  };

  const add = () => {
    const text = input.trim();
    if (!text) return;
    save([...goals, { text, done: false }]);
    setInput('');
  };

  const polish = () => {
    // The old page called Anthropic directly with a user-pasted key; without
    // one it added as-typed. Same fallback here.
    if (!input.trim()) return;
    add();
    showStatus('Polish needs an Anthropic API key — added as-typed.');
  };

  const toggle = (idx: number, checked: boolean) => {
    const list = goals.slice();
    if (!list[idx]) return;
    list[idx] = { ...list[idx], done: checked, doneAt: checked ? Date.now() : undefined };
    save(list);
  };

  const remove = (idx: number) => {
    const list = goals.slice();
    list.splice(idx, 1);
    save(list);
  };

  const toggleQueue = (idx: number) => {
    const list = goals.slice();
    if (!list[idx]) return;
    list[idx] = { ...list[idx], queued: !list[idx].queued };
    save(list);
  };

  const editText = (idx: number, next: string) => {
    const list = goals.slice();
    if (!list[idx] || !next.trim()) return;
    list[idx] = { ...list[idx], text: next.trim() };
    save(list);
  };

  const drop = (to: number) => {
    if (dragIdx == null || dragIdx === to) return;
    const list = goals.slice();
    const [moved] = list.splice(dragIdx, 1);
    list.splice(to, 0, moved);
    save(list);
  };

  const pushRemaining = () => {
    const remaining = goals.filter((g) => !g.done);
    if (!remaining.length) return;
    if (
      !window.confirm(
        `Move ${remaining.length} unchecked goal${remaining.length === 1 ? '' : 's'} to tomorrow?`,
      )
    )
      return;
    const tmr = getGoals(tomorrowKey());
    const seen = new Set(tmr.map((g) => g.text));
    remaining.forEach((g) => {
      if (!seen.has(g.text)) {
        tmr.push({ text: g.text, done: false });
        seen.add(g.text);
      }
    });
    storeSet(tomorrowKey(), tmr);
    storeSet(todayKey(), goals.filter((g) => g.done));
  };

  const isToday = !readOnly;
  const done = goals.filter((g) => g.done).length;
  const visible = expanded ? goals : goals.slice(0, 5);

  return (
    <Card>
      <div className="mb-1.5 font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink-3">
        {title}
      </div>
      {subtitle && <div className="mb-2 text-[12px] text-ink-3">{subtitle}</div>}
      <div className="mb-3.5">{header}</div>

      {isToday && goals.length > 0 && (
        <div className="mb-4 flex h-[6px] gap-1">
          {goals.map((g, i) => (
            <span
              key={i}
              className="flex-1 rounded-[3px] transition-all"
              style={{
                background: g.done ? accent.from : 'rgba(255,255,255,0.06)',
                boxShadow: g.done ? `0 0 6px ${accent.from}66` : undefined,
              }}
            />
          ))}
        </div>
      )}

      {goals.length === 0 ? (
        <EmptyState>
          {isToday ? 'No goals for today yet — add one below.' : 'Nothing planned for tomorrow yet'}
        </EmptyState>
      ) : (
        <ul className="m-0 list-none p-0">
          <AnimatePresence initial={false}>
            {visible.map((g, i) => (
              <motion.li
                key={`${g.text}-${i}`}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                transition={{ duration: 0.22 }}
                draggable={!readOnly}
                onDragStart={() => setDragIdx(i)}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOverIdx(i);
                }}
                onDragLeave={() => setOverIdx(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  drop(i);
                  setDragIdx(null);
                  setOverIdx(null);
                }}
                className={`group mb-1.5 flex items-center gap-3 rounded-xl border px-3.5 py-3 transition-colors ${
                  g.queued
                    ? 'border-transparent bg-warn/10 shadow-[inset_3px_0_0_0_#F2C063]'
                    : 'border-white/[0.06] bg-white/[0.035] hover:bg-white/[0.06]'
                } ${g.done ? 'opacity-45' : ''} ${overIdx === i && dragIdx !== null ? 'border-t-2 border-t-good' : ''}`}
              >
                {!readOnly && (
                  <span className="cursor-grab text-ink-4 opacity-0 transition-opacity group-hover:opacity-100 active:cursor-grabbing">
                    <GripVertical size={13} aria-hidden />
                  </span>
                )}
                <input
                  type="checkbox"
                  checked={!!g.done}
                  disabled={readOnly}
                  onChange={(e) => toggle(i, e.target.checked)}
                  title={readOnly ? 'Activates at 6 AM tomorrow' : undefined}
                  className="h-[22px] w-[22px] shrink-0 cursor-pointer appearance-none rounded-[7px] border-[1.5px] border-white/20 bg-black/30 transition-all checked:border-good checked:bg-good checked:shadow-[0_0_12px_rgba(107,227,164,0.4)] disabled:cursor-not-allowed disabled:opacity-55"
                  style={
                    g.done
                      ? {
                          backgroundImage:
                            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%230A0A0B' stroke-width='3.4' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='20 6 9 17 4 12'/%3E%3C/svg%3E\")",
                          backgroundSize: '13px',
                          backgroundPosition: 'center',
                          backgroundRepeat: 'no-repeat',
                        }
                      : undefined
                  }
                />
                <EditableText
                  value={g.text}
                  done={g.done}
                  queued={g.queued}
                  onCommit={(next) => editText(i, next)}
                />
                <button
                  type="button"
                  onClick={() => toggleQueue(i)}
                  disabled={readOnly}
                  title="Queue for productivity window"
                  className={`cursor-pointer rounded-md px-1.5 py-1 transition-all disabled:cursor-not-allowed disabled:opacity-30 ${
                    g.queued
                      ? 'text-warn drop-shadow-[0_0_4px_rgba(242,192,99,0.65)]'
                      : 'text-ink-3 opacity-55 hover:opacity-100'
                  }`}
                  aria-label="Queue goal"
                  aria-pressed={!!g.queued}
                >
                  <Zap size={14} aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => remove(i)}
                  className="cursor-pointer px-1 text-ink-3 opacity-50 transition-colors hover:text-bad group-hover:opacity-100"
                  aria-label="Delete goal"
                >
                  <X size={15} aria-hidden />
                </button>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}

      {goals.length > 5 && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="mt-1.5 w-full cursor-pointer rounded-[10px] border border-dashed border-white/[0.12] py-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3 transition-colors hover:border-white/25 hover:text-ink"
        >
          {expanded ? 'Show less ▴' : `Show ${goals.length - 5} more ▾`}
        </button>
      )}

      {isToday && goals.length > 0 && done < goals.length && (
        <button
          type="button"
          onClick={pushRemaining}
          className="mt-3.5 w-full cursor-pointer rounded-xl border border-dashed border-white/[0.16] py-2.5 text-[11px] font-bold uppercase tracking-[0.1em] text-ink-3 transition-all hover:border-solid hover:border-white/30 hover:bg-white/[0.04] hover:text-ink"
        >
          Push remaining to tomorrow
        </button>
      )}

      <div className="mt-3.5 flex flex-wrap items-center gap-2 border-t border-white/[0.06] pt-3.5">
        <TextInput
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          placeholder={isToday ? 'Add a goal for today…' : 'Add a goal for tomorrow…'}
          autoComplete="off"
          className="min-w-0 flex-1"
        />
        <PrimaryButton onClick={add}>+ Add</PrimaryButton>
        <GhostButton onClick={polish}>✨ Polish</GhostButton>
        {status && (
          <div className={`w-full text-[11px] ${status.error ? 'text-bad' : 'text-ink-3'}`}>
            {status.msg}
          </div>
        )}
      </div>
    </Card>
  );
}

function EditableText({
  value,
  done,
  queued,
  onCommit,
}: {
  value: string;
  done: boolean;
  queued?: boolean;
  onCommit: (next: string) => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(value);

  React.useEffect(() => setDraft(value), [value]);

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setEditing(false);
          if (draft.trim() && draft !== value) onCommit(draft);
          else setDraft(value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            setDraft(value);
            setEditing(false);
          }
        }}
        className="min-w-0 flex-1 rounded border border-white/20 bg-black/30 px-1.5 py-0.5 text-[14px] text-ink outline-none"
      />
    );
  }
  return (
    <span
      onClick={() => setEditing(true)}
      className={`min-w-0 flex-1 cursor-text truncate text-[14px] ${
        queued ? 'text-[#FFE2A8]' : 'text-ink'
      } ${done ? 'line-through decoration-white/40' : ''}`}
    >
      {value}
    </span>
  );
}
