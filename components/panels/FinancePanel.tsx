'use client';

// Finance panel — port of finance.html. Four sub-tabs (Net Worth / Subs /
// Orders / Wishlist), renewal ticker, all-time chart, allocation donut,
// activity log, auto-deduct subscriptions, order deduct chooser.

import * as React from 'react';
import { BarChart3, Package, Repeat, Target as TargetIcon, X } from 'lucide-react';
import type { BentoAccent } from '@/components/ui/aurora-bento-grid';
import { storeGet, storeSet, useStorageTick } from '@/lib/storage';
import { ensureRates, fmtMoney as fx, getRates } from '@/lib/fx';
import {
  NW_CATS,
  SUBS_SLICE,
  fmtActivityDate,
  getNwItems,
  listAllNwAccounts,
  logActivity,
  logNetWorthSnapshot,
  monthlyEquivalent,
  nextRenewalDate,
  nwGrandCHF,
  pctClass,
  processAutoDeductSubs,
  type Activity,
  type NwCatKey,
  type Order,
  type Sub,
  type Wish,
} from '@/lib/finance';
import { Card, Eyebrow, GhostButton, SelectInput, TextInput } from './shared';

type Tab = 'net' | 'subs' | 'incoming' | 'wish';
const CCYS = ['CHF', 'USD', 'EUR', 'GBP'];
const CAT_ICON: Record<string, string> = { bank: '🏦', stocks: '📈', crypto: '🪙', other: '💼' };
const PCT_TXT: Record<string, string> = { good: 'text-good', warn: 'text-warn', bad: 'text-bad' };

export default function FinancePanel({ accent }: { accent: BentoAccent }) {
  const tick = useStorageTick();
  const [, force] = React.useReducer((x: number) => x + 1, 0);
  const [tab, setTab] = React.useState<Tab>(() => {
    const saved = storeGet<Tab>('finance_active_tab');
    return saved && ['net', 'subs', 'incoming', 'wish'].includes(saved) ? saved : 'net';
  });

  React.useEffect(() => {
    ensureRates();
    processAutoDeductSubs();
    const t = setInterval(force, 30 * 1000); // renewal-day countdown freshness
    return () => clearInterval(t);
  }, []);

  const currency = storeGet<string>('nw_currency') || 'CHF';
  const money = (chf: number) => fx(chf, currency);

  const grand = React.useMemo(() => nwGrandCHF(), [tick]);
  React.useEffect(() => {
    logNetWorthSnapshot(grand);
  }, [grand]);

  const subs = storeGet<Sub[]>('subs') || [];
  const orders = storeGet<Order[]>('incoming_orders') || [];
  const wishes = storeGet<Wish[]>('wishlist') || [];

  const switchTab = (t: Tab) => {
    setTab(t);
    storeSet('finance_active_tab', t);
  };

  return (
    <div className="flex flex-col gap-4 pb-2 pt-2">
      <RenewalTicker subs={subs} money={money} />

      {/* sub-tabs */}
      <div className="flex gap-1 rounded-2xl border border-white/[0.07] bg-white/[0.03] p-1">
        {(
          [
            ['net', 'Net Worth', BarChart3],
            ['subs', 'Subs', Repeat],
            ['incoming', 'Orders', Package],
            ['wish', 'Wishlist', TargetIcon],
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            onClick={() => switchTab(id)}
            aria-selected={tab === id}
            className={`flex flex-1 cursor-pointer flex-col items-center gap-0.5 rounded-xl border px-2 py-2 transition-colors ${
              tab === id
                ? 'border-white/10 bg-white/[0.06] text-ink'
                : 'border-transparent text-ink-3 hover:bg-white/[0.025] hover:text-ink-2'
            }`}
          >
            <Icon size={16} aria-hidden />
            <span className="text-[10px] font-bold uppercase tracking-[0.1em]">{label}</span>
          </button>
        ))}
      </div>

      {tab === 'net' && <NetWorthTab money={money} currency={currency} grand={grand} subs={subs} accent={accent} />}
      {tab === 'subs' && <SubsTab money={money} subs={subs} accent={accent} />}
      {tab === 'incoming' && <OrdersTab money={money} orders={orders} grand={grand} />}
      {tab === 'wish' && <WishTab money={money} wishes={wishes} grand={grand} />}
    </div>
  );
}

// ============================ ticker ========================================
function RenewalTicker({ subs, money }: { subs: Sub[]; money: (n: number) => string }) {
  const entries = React.useMemo(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const out: { name: string; amount: number; days: number }[] = [];
    subs.forEach((s) => {
      if (!s.renewal) return;
      const next = nextRenewalDate(s.renewal, s.period);
      if (!next) return;
      out.push({ name: s.name, amount: Number(s.amount) || 0, days: Math.round((next.getTime() - today) / 86400000) });
    });
    return out.sort((a, b) => a.days - b.days);
  }, [subs]);

  const [idx, setIdx] = React.useState(0);
  React.useEffect(() => {
    setIdx(0);
    if (entries.length <= 1) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % entries.length), 5000);
    return () => clearInterval(t);
  }, [entries.length]);

  if (!entries.length) return null;
  const cur = entries[Math.min(idx, entries.length - 1)];
  const urgent = cur.days <= 5;
  const daysLabel =
    cur.days < 0 ? `${Math.abs(cur.days)}d late` : cur.days === 0 ? 'TODAY' : cur.days === 1 ? 'TOMORROW' : `in ${cur.days}d`;

  return (
    <div
      className={`flex min-h-[38px] items-center gap-3 rounded-xl border px-3.5 py-2.5 font-mono text-[12px] transition-colors ${
        urgent
          ? 'animate-pulse border-bad/30 bg-gradient-to-r from-bad/10 to-bad/[0.04]'
          : 'border-good/[0.14] bg-gradient-to-r from-good/[0.06] to-sky-300/[0.04]'
      }`}
      aria-live="polite"
    >
      <span
        className={`shrink-0 rounded-full px-2 py-0.5 text-[9.5px] font-extrabold uppercase tracking-[0.18em] ${
          urgent ? 'bg-bad/10 text-bad' : 'bg-black/30 text-ink-3'
        }`}
      >
        RENEWS
      </span>
      <span className="min-w-0 flex-1 truncate tabular-nums text-ink-2">
        <span className="font-bold uppercase tracking-[0.04em] text-ink">{cur.name}</span>{' '}
        <span className={`font-bold ${urgent ? 'text-bad' : 'text-good'}`}>{money(cur.amount)}</span>{' '}
        <span className={`text-[11px] uppercase tracking-[0.06em] ${urgent ? 'font-bold text-bad' : 'text-ink-3'}`}>
          {daysLabel}
        </span>
      </span>
      <span className="flex shrink-0 gap-1">
        {entries.map((_, i) => (
          <span
            key={i}
            className={`h-[5px] w-[5px] rounded-full ${i === idx ? (urgent ? 'bg-bad' : 'bg-good') : 'bg-white/[0.18]'}`}
          />
        ))}
      </span>
    </div>
  );
}

// ============================ net worth =====================================
function NetWorthTab({
  money,
  currency,
  grand,
  subs,
  accent,
}: {
  money: (n: number) => string;
  currency: string;
  grand: number;
  subs: Sub[];
  accent: BentoAccent;
}) {
  const hist = storeGet<{ t: number; v: number }[]>('nw:history') || [];
  const activity = (storeGet<Activity[]>('nw:activity') || []).slice().sort((a, b) => b.ts - a.ts);

  const breakdown = NW_CATS.map((cat) => ({
    cat,
    total: getNwItems(cat.key).reduce((s, it) => s + (Number(it.amount) || 0), 0),
  }));

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.04em] text-ink-3">Total net worth</div>
          <div className="mt-0.5 font-mono text-[32px] font-bold leading-tight text-ink tabular-nums">
            {money(grand)}
          </div>
          <div className="mt-1 text-[11px] text-ink-3">
            {breakdown
              .filter((b) => b.total > 0)
              .map((b) => `${b.cat.key}: ${money(b.total)}`)
              .join('  •  ')}
          </div>
        </div>
        <SelectInput
          value={currency}
          onChange={(e) => storeSet('nw_currency', e.target.value)}
          aria-label="Display currency"
          className="px-2.5 py-1.5 text-[12px]"
        >
          {CCYS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </SelectInput>
      </div>

      {/* chart + donut */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-[1.6fr_1fr]">
        <NwChart hist={hist} money={money} />
        <AllocationDonut subs={subs} money={money} />
      </div>

      {/* activity */}
      <Card>
        <div className="mb-2.5 flex items-center justify-between font-mono text-[9.5px] font-extrabold uppercase tracking-[0.16em]">
          <span className="text-ink-3">Recent activity</span>
          <span className="text-ink-3 tabular-nums">
            {activity.length ? `${activity.length} event${activity.length === 1 ? '' : 's'}` : '—'}
          </span>
        </div>
        {!activity.length ? (
          <div className="py-3 text-center text-[11px] italic text-ink-3">No activity yet — add your first account.</div>
        ) : (
          <div className="flex max-h-[156px] flex-col gap-1.5 overflow-y-auto pr-1">
            {activity.slice(0, 30).map((e, i) => {
              const meta = NW_CATS.find((c) => c.key === e.cat) || { label: e.cat, color: '#FFFFFF' };
              const up = e.delta >= 0;
              return (
                <div
                  key={`${e.ts}-${i}`}
                  className="grid grid-cols-[4px_1fr_auto_auto] items-center gap-2.5 rounded-lg bg-white/[0.025] px-3 py-2 text-[12.5px]"
                >
                  <span className="h-6 w-1 rounded-sm" style={{ background: meta.color, boxShadow: `0 0 6px ${meta.color}` }} />
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-semibold text-ink">{e.name || '(unnamed)'}</span>
                    <span className="block font-mono text-[10.5px] uppercase tracking-[0.04em] text-ink-3">
                      {'label' in meta ? meta.label : e.cat} · {e.kind === 'edit' ? 'EDIT' : e.kind === 'delete' ? 'DELETE' : 'ADD'}
                    </span>
                  </span>
                  <span className={`whitespace-nowrap font-mono text-[13px] font-bold tabular-nums ${up ? 'text-good' : 'text-bad'}`}>
                    {up ? '+' : '—'}
                    {money(Math.abs(e.delta))}
                  </span>
                  <span className="whitespace-nowrap font-mono text-[10.5px] tabular-nums text-ink-3">
                    {fmtActivityDate(e.ts)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* category cards */}
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {NW_CATS.map((cat) => (
          <NwCategoryCard key={cat.key} catKey={cat.key} label={`${cat.icon} ${cat.label}`} money={money} currency={currency} />
        ))}
      </div>
    </>
  );
}

function NwChart({ hist, money }: { hist: { t: number; v: number }[]; money: (n: number) => string }) {
  const W = 600, H = 200, pad = 8;
  const vals = hist.map((p) => p.v);
  const hasData = hist.length >= 1;
  const first = vals[0] ?? 0;
  const last = vals[vals.length - 1] ?? 0;
  const change = last - first;
  const dir = Math.abs(change) < 0.005 ? 'flat' : change > 0 ? 'up' : 'down';
  const color = dir === 'up' ? '#6BE3A4' : dir === 'down' ? '#FF8A8A' : '#76746E';

  let deltaText = '—';
  if (hasData) {
    if (dir === 'flat') deltaText = 'Flat';
    else if (Math.abs(first) < 0.5) deltaText = `${change > 0 ? '+' : '—'}${money(Math.abs(change))}`;
    else {
      const pct = Math.abs((change / Math.abs(first)) * 100);
      deltaText = `${change > 0 ? '+' : '—'}${pct >= 100 ? pct.toFixed(0) : pct >= 10 ? pct.toFixed(1) : pct.toFixed(2)}%`;
    }
  }

  let lineD = '';
  let areaD = '';
  if (hist.length === 1) {
    const y = H / 2;
    lineD = `M0,${y} L${W},${y}`;
    areaD = `M0,${y} L${W},${y} L${W},${H} L0,${H} Z`;
  } else if (hist.length > 1) {
    const minV = Math.min(...vals);
    const maxV = Math.max(...vals);
    const range = maxV - minV || Math.max(1, Math.abs(maxV));
    const points = hist.map((p, i) => ({
      x: (i / (hist.length - 1)) * W,
      y: H - pad - ((p.v - minV) / range) * (H - pad * 2),
    }));
    const d: string[] = [`M${points[0].x},${points[0].y}`];
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i - 1] || points[i];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[i + 2] || p2;
      d.push(
        `C${p1.x + (p2.x - p0.x) / 6},${p1.y + (p2.y - p0.y) / 6} ${p2.x - (p3.x - p1.x) / 6},${p2.y - (p3.y - p1.y) / 6} ${p2.x},${p2.y}`,
      );
    }
    lineD = d.join(' ');
    areaD = `${lineD} L${points[points.length - 1].x},${H} L${points[0].x},${H} Z`;
  }

  const high = hasData ? Math.max(...vals) : 0;
  const low = hasData ? Math.min(...vals) : 0;

  return (
    <Card className="relative overflow-hidden">
      <div className="mb-2 flex items-center justify-between font-mono text-[9.5px] font-extrabold uppercase tracking-[0.16em]">
        <span className="text-ink-3">All-time</span>
        <span className={dir === 'up' ? 'text-good' : dir === 'down' ? 'text-bad' : 'text-ink-3'}>{deltaText}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block h-[170px] w-full" style={{ color }} aria-hidden>
        <defs>
          <linearGradient id="nwGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.55" />
            <stop offset="60%" stopColor="currentColor" stopOpacity="0.18" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[40, 100, 160].map((y) => (
          <line key={y} x1="0" x2={W} y1={y} y2={y} stroke="rgba(255,255,255,0.05)" strokeWidth="1" strokeDasharray="2 4" vectorEffect="non-scaling-stroke" />
        ))}
        <path d={areaD} fill="url(#nwGrad)" />
        <path d={lineD} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" style={{ filter: 'drop-shadow(0 0 6px currentColor)' }} />
      </svg>
      {!hasData && (
        <div className="pointer-events-none absolute inset-x-4 bottom-14 top-10 flex items-center justify-center text-center text-[11px] italic text-ink-3">
          Add or edit an asset to start tracking your net worth over time.
        </div>
      )}
      <div className="mt-3 grid grid-cols-2 gap-1.5 border-t border-white/[0.05] pt-3 sm:grid-cols-4">
        {(
          [
            ['1% =', hasData ? money(last / 100) : '—'],
            ['All-time high', hasData ? money(high) : '—'],
            ['All-time low', hasData ? money(low) : '—'],
            ['Snapshots', String(hist.length)],
          ] as const
        ).map(([label, val]) => (
          <div key={label} className="px-1.5 py-1">
            <div className="font-mono text-[9px] font-extrabold uppercase tracking-[0.16em] text-ink-3">{label}</div>
            <div className="truncate font-mono text-[13px] font-bold tabular-nums text-ink">{val}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function donutArcPath(cx: number, cy: number, rO: number, rI: number, a1: number, a2: number): string {
  const large = a2 - a1 > Math.PI ? 1 : 0;
  const f = (n: number) => n.toFixed(2);
  return (
    `M ${f(cx + rO * Math.cos(a1))} ${f(cy + rO * Math.sin(a1))}` +
    ` A ${rO} ${rO} 0 ${large} 1 ${f(cx + rO * Math.cos(a2))} ${f(cy + rO * Math.sin(a2))}` +
    ` L ${f(cx + rI * Math.cos(a2))} ${f(cy + rI * Math.sin(a2))}` +
    ` A ${rI} ${rI} 0 ${large} 0 ${f(cx + rI * Math.cos(a1))} ${f(cy + rI * Math.sin(a1))} Z`
  );
}

function AllocationDonut({ subs, money }: { subs: Sub[]; money: (n: number) => string }) {
  // one slice per account, colored by category; annualized subs as outflow slice
  const slices: { key: string; name: string; color: string; value: number }[] = [];
  NW_CATS.forEach((cat) => {
    getNwItems(cat.key).forEach((it, i) => {
      const v = Number(it.amount) || 0;
      if (v > 0) slices.push({ key: `${cat.key}::${i}`, name: String(it.name || '(unnamed)'), color: cat.color, value: v });
    });
  });
  const annualSubs = subs.reduce((s, it) => s + monthlyEquivalent(it) * 12, 0);
  if (annualSubs > 0) slices.push({ key: 'subs', name: SUBS_SLICE.name, color: SUBS_SLICE.color, value: annualSubs });
  const total = slices.reduce((s, x) => s + x.value, 0);
  const grand = nwGrandCHF();
  slices.sort((a, b) => b.value - a.value);

  let angle = -Math.PI / 2;
  const paths: { d: string; color: string; key: string }[] = [];
  slices.forEach((s) => {
    const sliceAngle = (s.value / (total || 1)) * Math.PI * 2;
    const p = slices.length > 1 ? 0.015 : 0;
    if (angle + sliceAngle - p > angle + p) {
      paths.push({ d: donutArcPath(70, 70, 60, 44, angle + p, angle + sliceAngle - p), color: s.color, key: s.key });
    }
    angle += sliceAngle;
  });

  return (
    <Card className="flex flex-col">
      <div className="mb-2 flex items-center justify-between font-mono text-[9.5px] font-extrabold uppercase tracking-[0.16em] text-ink-3">
        <span>Allocation</span>
        <span className="tabular-nums">{slices.length ? `${slices.length} slice${slices.length === 1 ? '' : 's'}` : '—'}</span>
      </div>
      <div className="relative mx-auto mb-1.5 mt-1 h-[140px] w-[140px]">
        <svg viewBox="0 0 140 140" className="block h-[140px] w-[140px] -rotate-90" aria-hidden>
          {!slices.length ? (
            <>
              <circle cx="70" cy="70" r="60" fill="rgba(255,255,255,0.025)" />
              <circle cx="70" cy="70" r="44" fill="#0A0A0B" />
            </>
          ) : (
            paths.map((p) => <path key={p.key} d={p.d} fill={p.color} />)
          )}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <div className="font-mono text-[15px] font-bold leading-none tracking-tight text-ink tabular-nums">
            {slices.length ? money(grand).split(' ')[1] || money(grand) : '—'}
          </div>
          <div className="mt-1 text-[9px] font-bold uppercase tracking-[0.18em] text-ink-3">total</div>
        </div>
      </div>
      {!slices.length ? (
        <div className="py-2 text-center text-[11px] italic text-ink-3">Add an account to see your breakdown</div>
      ) : (
        <div className="mt-2 flex flex-col gap-1">
          {slices.map((s) => (
            <div key={s.key} className="grid grid-cols-[8px_1fr_auto] items-center gap-2 rounded-md px-1.5 py-1 text-[11px] tabular-nums">
              <span className="h-2 w-2 rounded-full" style={{ background: s.color, boxShadow: `0 0 6px ${s.color}` }} />
              <span className="truncate text-ink-2">{s.name}</span>
              <span className="font-mono text-[10.5px] font-bold text-ink">{((s.value / total) * 100).toFixed(1)}%</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function NwCategoryCard({
  catKey,
  label,
  money,
  currency,
}: {
  catKey: NwCatKey;
  label: string;
  money: (n: number) => string;
  currency: string;
}) {
  const items = getNwItems(catKey);
  const total = items.reduce((s, it) => s + (Number(it.amount) || 0), 0);
  const [name, setName] = React.useState('');
  const [amount, setAmount] = React.useState('');
  const [editIdx, setEditIdx] = React.useState<number | null>(null);
  const [editVal, setEditVal] = React.useState('');
  const [nameEditIdx, setNameEditIdx] = React.useState<number | null>(null);
  const [nameVal, setNameVal] = React.useState('');

  const rate = getRates()[currency as keyof ReturnType<typeof getRates>] || 1;

  const add = () => {
    const n = name.trim();
    const a = parseFloat(amount);
    if (!n || isNaN(a)) return;
    // typed in the display currency → store CHF
    const amountCHF = a / rate;
    storeSet(`nw:${catKey}`, [...items, { name: n, amount: amountCHF }]);
    logActivity(catKey, n, amountCHF, 'add');
    setName('');
    setAmount('');
  };

  const commitAmount = (idx: number) => {
    const v = editVal.trim();
    setEditIdx(null);
    if (v === '') return;
    const curCHF = Number(items[idx].amount) || 0;
    const curDisplay = curCHF * rate;
    let nextDisplay = curDisplay;
    if (/^[+\-]\s*\d/.test(v)) {
      const delta = parseFloat(v.replace(/\s+/g, ''));
      if (!isNaN(delta)) nextDisplay = curDisplay + delta;
    } else {
      const n = parseFloat(v);
      if (!isNaN(n)) nextDisplay = n;
    }
    if (nextDisplay < 0) nextDisplay = 0;
    const nextCHF = nextDisplay / rate;
    const deltaCHF = nextCHF - curCHF;
    const next = items.slice();
    next[idx] = { ...next[idx], amount: nextCHF };
    storeSet(`nw:${catKey}`, next);
    if (Math.abs(deltaCHF) > 0.005) logActivity(catKey, next[idx].name, deltaCHF, 'edit');
  };

  return (
    <Card className="flex flex-col p-4">
      <div className="mb-2.5 flex items-center justify-between font-mono text-[9.5px] font-extrabold uppercase tracking-[0.16em] text-ink-3">
        <span>{label}</span>
        <span className="font-sans text-[13px] font-semibold normal-case tracking-normal text-ink">{money(total)}</span>
      </div>
      <div className="text-[13px]">
        {items.map((it, idx) => (
          <div key={idx} className="flex min-w-0 items-center justify-between gap-2 py-1">
            {nameEditIdx === idx ? (
              <input
                autoFocus
                value={nameVal}
                onChange={(e) => setNameVal(e.target.value)}
                onBlur={() => {
                  setNameEditIdx(null);
                  if (nameVal.trim()) {
                    const next = items.slice();
                    next[idx] = { ...next[idx], name: nameVal.trim() };
                    storeSet(`nw:${catKey}`, next);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  if (e.key === 'Escape') setNameEditIdx(null);
                }}
                className="min-w-0 flex-1 rounded-md border border-white/10 bg-black/30 px-2 py-1 text-[13px] text-ink outline-none"
              />
            ) : (
              <span
                title="Tap to rename"
                onClick={() => {
                  setNameEditIdx(idx);
                  setNameVal(it.name);
                }}
                className="min-w-0 flex-1 cursor-pointer truncate rounded px-1 py-0.5 text-ink hover:bg-white/[0.06]"
              >
                {it.name}
              </span>
            )}
            {editIdx === idx ? (
              <input
                autoFocus
                inputMode="decimal"
                value={editVal}
                onChange={(e) => setEditVal(e.target.value)}
                onBlur={() => commitAmount(idx)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  if (e.key === 'Escape') setEditIdx(null);
                }}
                className="w-[110px] rounded-md border border-white/10 bg-black/30 px-2 py-1 text-right font-mono text-[12px] text-ink tabular-nums outline-none"
              />
            ) : (
              <span
                title="Tap to edit · type +500 to add, -200 to subtract, or a new total"
                onClick={() => {
                  const cur = (Number(it.amount) || 0) * rate;
                  setEditIdx(idx);
                  setEditVal(String(cur.toFixed(cur % 1 === 0 ? 0 : 2)));
                }}
                className="shrink-0 cursor-pointer whitespace-nowrap rounded px-1 py-0.5 font-mono text-[12px] font-semibold text-ink tabular-nums hover:bg-white/[0.06]"
              >
                {money(it.amount)}
              </span>
            )}
            <button
              type="button"
              aria-label="Delete"
              onClick={() => {
                const removed = items[idx];
                const next = items.filter((_, j) => j !== idx);
                storeSet(`nw:${catKey}`, next);
                if (removed) logActivity(catKey, removed.name, -(Number(removed.amount) || 0), 'delete');
              }}
              className="shrink-0 cursor-pointer px-1 text-ink-3 hover:text-bad"
            >
              <X size={13} aria-hidden />
            </button>
          </div>
        ))}
      </div>
      <div className="mt-auto grid grid-cols-[1fr_92px_auto] gap-1.5 pt-2.5">
        <TextInput value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="Name" className="min-w-0 px-2.5 py-2 text-[13px]" />
        <TextInput type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="Amount" className="min-w-0 px-2.5 py-2 text-right text-[13px]" />
        <button type="button" onClick={add} className="cursor-pointer rounded-lg bg-white/[0.06] px-3.5 text-[14px] font-bold text-ink-2 transition-colors hover:bg-white/[0.12] hover:text-ink active:scale-95">
          +
        </button>
      </div>
    </Card>
  );
}

// ============================ subs ==========================================
function SubsTab({ money, subs, accent }: { money: (n: number) => string; subs: Sub[]; accent: BentoAccent }) {
  const monthly = subs.reduce((s, it) => s + monthlyEquivalent(it), 0);
  const accounts = listAllNwAccounts();
  const [editIdx, setEditIdx] = React.useState<number | null>(null);

  const saveSubs = (next: Sub[]) => storeSet('subs', next);

  return (
    <Card
      className="border"
      // subtle indigo/rose wash like the old subs card
      style={{ background: 'linear-gradient(135deg, rgba(83,74,183,0.07), rgba(216,90,48,0.05))' }}
    >
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.04em] text-ink-3">Monthly burn</div>
          <div className="mt-0.5 font-mono text-[26px] font-bold leading-tight text-ink tabular-nums">
            {money(monthly)} <span className="text-[13px] font-medium text-ink-3">/ mo</span>
          </div>
          <div className="mt-0.5 text-[11px] text-ink-3">{subs.length ? `~${money(monthly * 12)} per year` : ''}</div>
        </div>
        <div className="text-[11px] text-ink-3">
          {subs.length ? `${subs.length} subscription${subs.length === 1 ? '' : 's'}` : ''}
        </div>
      </div>

      {!subs.length && <div className="py-4 text-center font-mono text-[11px] font-bold uppercase tracking-[0.1em] text-ink-3">· No subscriptions yet</div>}

      {subs.map((it, idx) =>
        editIdx === idx ? (
          <SubEditor
            key={idx}
            sub={it}
            accounts={accounts}
            onCancel={() => setEditIdx(null)}
            onSave={(next) => {
              const arr = subs.slice();
              arr[idx] = next;
              saveSubs(arr);
              setEditIdx(null);
            }}
          />
        ) : (
          <SubRow
            key={idx}
            sub={it}
            money={money}
            onEdit={() => setEditIdx(idx)}
            onDelete={() => {
              if (!window.confirm(`Delete "${it.name}"?`)) return;
              saveSubs(subs.filter((_, j) => j !== idx));
            }}
            onToggleAuto={() => {
              const arr = subs.slice();
              if (!arr[idx].autoDeduct && (!arr[idx].fromCat || !arr[idx].fromAccount)) {
                alert('Pick a "From account" first (use the ✏ edit button) so the deduction knows where to take the money from.');
                return;
              }
              arr[idx] = { ...arr[idx], autoDeduct: !arr[idx].autoDeduct };
              saveSubs(arr);
            }}
          />
        ),
      )}

      <SubAddForm accounts={accounts} onAdd={(sub) => saveSubs([...subs, sub])} accent={accent} />
    </Card>
  );
}

function formatRenewal(iso: string): string {
  const isoSafe = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00` : iso;
  const d = new Date(isoSafe);
  if (isNaN(d.getTime())) return iso;
  const now = new Date();
  const diffDays = Math.round(
    (new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() -
      new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) /
      86400000,
  );
  const dateLabel = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const prefix =
    diffDays < 0 ? 'past · ' : diffDays === 0 ? 'today · ' : diffDays === 1 ? 'tomorrow · ' : diffDays <= 7 ? `in ${diffDays}d · ` : '';
  return prefix + dateLabel;
}

function SubRow({
  sub,
  money,
  onEdit,
  onDelete,
  onToggleAuto,
}: {
  sub: Sub;
  money: (n: number) => string;
  onEdit: () => void;
  onDelete: () => void;
  onToggleAuto: () => void;
}) {
  const m = monthlyEquivalent(sub);
  let daysToRenew: number | null = null;
  if (sub.renewal) {
    const next = nextRenewalDate(sub.renewal, sub.period);
    if (next) {
      const now = new Date();
      daysToRenew = Math.round(
        (next.getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86400000,
      );
    }
  }
  const urgent = daysToRenew != null && daysToRenew <= 5;

  return (
    <div
      className={`mb-2 grid grid-cols-[1fr_auto_auto] items-center gap-3 rounded-xl px-3.5 py-3 ${
        urgent ? 'animate-pulse border border-bad/30 bg-gradient-to-br from-bad/[0.14] to-bad/[0.06]' : 'bg-white/[0.025]'
      }`}
    >
      <div className="min-w-0">
        <div className="text-[14px] font-semibold text-ink">{sub.name}</div>
        <div className="mt-0.5 text-[11px] capitalize text-ink-3">{sub.period}</div>
        {sub.renewal && (
          <div className={`mt-0.5 text-[10px] ${urgent ? 'font-bold text-bad' : 'text-warn'}`}>
            ↻ Renews {formatRenewal(sub.renewal)}
          </div>
        )}
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {sub.fromCat && sub.fromAccount && (
            <span className="inline-flex items-center gap-1 rounded-full border border-sky-300/20 bg-sky-300/10 px-2 py-0.5 font-mono text-[10px] font-bold tracking-[0.04em] text-sky-200">
              from · {sub.fromAccount}
            </span>
          )}
          <button
            type="button"
            onClick={onToggleAuto}
            aria-pressed={!!sub.autoDeduct}
            className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2 py-1 font-mono text-[9.5px] font-bold uppercase tracking-[0.08em] transition-colors ${
              sub.autoDeduct
                ? 'border-good/30 bg-good/10 text-good'
                : 'border-white/[0.08] bg-white/[0.04] text-ink-3'
            }`}
            title="Auto-deduct from the linked account on each renewal"
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${sub.autoDeduct ? 'bg-good shadow-[0_0_6px_rgba(107,227,164,0.7)]' : 'bg-white/25'}`}
            />
            {sub.autoDeduct ? 'Auto-deduct ON' : 'Auto-deduct off'}
          </button>
        </div>
      </div>
      <div className="text-right leading-tight">
        <div className="font-mono text-[18px] font-bold text-ink tabular-nums">{money(m)}</div>
        <div className="mt-0.5 text-[10px] text-ink-3">/ month</div>
        {sub.entered_currency && sub.entered_currency !== 'CHF' && sub.entered_amount != null ? (
          <div className="mt-0.5 text-[10px] text-ink-3">
            billed {sub.entered_currency}{' '}
            {Number(sub.entered_amount).toLocaleString('en-US', { maximumFractionDigits: 2 })} / {sub.period}
          </div>
        ) : (
          sub.period !== 'monthly' && (
            <div className="mt-0.5 text-[10px] text-ink-3">
              billed {money(sub.amount)} / {sub.period}
            </div>
          )
        )}
      </div>
      <div className="flex flex-col items-center gap-1">
        <button type="button" title="Edit" onClick={onEdit} className="cursor-pointer rounded-md border border-white/10 px-2 py-1 text-[12px] text-ink-3 hover:text-ink">
          ✏
        </button>
        <button type="button" title="Delete" onClick={onDelete} className="cursor-pointer rounded-md border border-white/10 px-2 py-1 text-[12px] text-ink-3 hover:text-bad">
          ×
        </button>
      </div>
    </div>
  );
}

type NwAccount = ReturnType<typeof listAllNwAccounts>[number];

function SubFormFields({
  accounts,
  name, setName, amount, setAmount, ccy, setCcy, period, setPeriod, renewal, setRenewal, fromVal, setFromVal, auto, setAuto,
}: {
  accounts: NwAccount[];
  name: string; setName: (v: string) => void;
  amount: string; setAmount: (v: string) => void;
  ccy: string; setCcy: (v: string) => void;
  period: Sub['period']; setPeriod: (v: Sub['period']) => void;
  renewal: string; setRenewal: (v: string) => void;
  fromVal: string; setFromVal: (v: string) => void;
  auto: boolean; setAuto: (v: boolean) => void;
}) {
  return (
    <>
      <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Service (e.g. Netflix)" className="min-w-0 text-[13px] sm:col-span-2" />
      <TextInput type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount" className="min-w-0 text-right text-[13px]" />
      <SelectInput value={ccy} onChange={(e) => setCcy(e.target.value)} className="text-[12px]">
        {CCYS.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </SelectInput>
      <SelectInput value={period} onChange={(e) => setPeriod(e.target.value as Sub['period'])} className="text-[12px]">
        <option value="monthly">Monthly</option>
        <option value="yearly">Yearly</option>
        <option value="weekly">Weekly</option>
      </SelectInput>
      <label className="flex min-w-0 cursor-pointer items-center gap-2 rounded-xl border border-white/[0.09] bg-black/30 px-3 py-2" title="Next renewal date">
        <span aria-hidden>📅</span>
        <input type="date" value={renewal} onChange={(e) => setRenewal(e.target.value)} className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none" />
      </label>
      <SelectInput value={fromVal} onChange={(e) => setFromVal(e.target.value)} disabled={!accounts.length} title="Which net worth account to deduct from" className="text-[12px]">
        {!accounts.length ? (
          <option value="">No accounts yet</option>
        ) : (
          <>
            <option value="">No account linked</option>
            {accounts.map((a) => (
              <option key={`${a.catKey}::${a.itemName}`} value={`${a.catKey}::${a.itemName}`}>
                {CAT_ICON[a.catKey]} {a.itemName}
              </option>
            ))}
          </>
        )}
      </SelectInput>
      <label className="flex cursor-pointer select-none items-center justify-between gap-2 rounded-xl border border-white/[0.09] bg-black/30 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.04em] sm:col-span-2">
        <span className={auto ? 'font-bold text-good' : 'text-ink-2'}>Auto-deduct</span>
        <button
          type="button"
          role="switch"
          aria-checked={auto}
          onClick={() => setAuto(!auto)}
          className={`relative h-4 w-[30px] cursor-pointer rounded-full transition-colors ${auto ? 'bg-good' : 'bg-white/10'}`}
        >
          <span
            className={`absolute top-0.5 h-3 w-3 rounded-full transition-all ${auto ? 'left-[14px] bg-[#04201A]' : 'left-0.5 bg-white'}`}
          />
        </button>
      </label>
    </>
  );
}

function SubAddForm({ accounts, onAdd, accent }: { accounts: NwAccount[]; onAdd: (s: Sub) => void; accent: BentoAccent }) {
  const [name, setName] = React.useState('');
  const [amount, setAmount] = React.useState('');
  const [ccy, setCcy] = React.useState('CHF');
  const [period, setPeriod] = React.useState<Sub['period']>('monthly');
  const [renewal, setRenewal] = React.useState('');
  const [fromVal, setFromVal] = React.useState('');
  const [auto, setAuto] = React.useState(false);

  const submit = () => {
    const n = name.trim();
    const aRaw = parseFloat(amount);
    if (!n || isNaN(aRaw)) return;
    const rate = getRates()[ccy as 'CHF'] || 1;
    let fromCat: string | null = null;
    let fromAccount: string | null = null;
    if (fromVal) {
      const ix = fromVal.indexOf('::');
      if (ix > 0) {
        fromCat = fromVal.slice(0, ix);
        fromAccount = fromVal.slice(ix + 2);
      }
    }
    if (auto && (!fromCat || !fromAccount)) {
      alert('Pick a "From account" first — auto-deduct needs to know where to take the money from.');
      return;
    }
    onAdd({
      name: n,
      amount: aRaw / rate,
      period,
      renewal: renewal || null,
      entered_amount: aRaw,
      entered_currency: ccy,
      fromCat,
      fromAccount,
      autoDeduct: auto,
      lastDeductedAt: null,
    });
    setName('');
    setAmount('');
    setRenewal('');
    setAuto(false);
  };

  return (
    <div className="mt-3 grid grid-cols-1 gap-2 rounded-xl bg-black/30 p-2 sm:grid-cols-4">
      <SubFormFields
        {...{ accounts, name, setName, amount, setAmount, ccy, setCcy, period, setPeriod, renewal, setRenewal, fromVal, setFromVal, auto, setAuto }}
      />
      <button
        type="button"
        onClick={submit}
        className="cursor-pointer rounded-lg px-3.5 py-2 text-[13px] font-bold text-black transition-transform hover:-translate-y-px active:scale-[0.97] sm:col-span-2"
        style={{ background: `linear-gradient(180deg, ${accent.from}, ${accent.to})` }}
      >
        + Add
      </button>
    </div>
  );
}

function SubEditor({
  sub,
  accounts,
  onSave,
  onCancel,
}: {
  sub: Sub;
  accounts: NwAccount[];
  onSave: (s: Sub) => void;
  onCancel: () => void;
}) {
  const [name, setName] = React.useState(sub.name);
  const [amount, setAmount] = React.useState(String(sub.entered_amount != null ? sub.entered_amount : sub.amount));
  const [ccy, setCcy] = React.useState(sub.entered_currency || 'CHF');
  const [period, setPeriod] = React.useState<Sub['period']>(sub.period);
  const [renewal, setRenewal] = React.useState(sub.renewal && /^\d{4}-\d{2}-\d{2}/.test(sub.renewal) ? sub.renewal.slice(0, 10) : '');
  const [fromVal, setFromVal] = React.useState(sub.fromCat && sub.fromAccount ? `${sub.fromCat}::${sub.fromAccount}` : '');
  const [auto, setAuto] = React.useState(!!sub.autoDeduct);

  const save = () => {
    const n = name.trim();
    const aRaw = parseFloat(amount);
    if (!n || isNaN(aRaw)) return;
    let fromCat: string | null = null;
    let fromAccount: string | null = null;
    if (fromVal) {
      const ix = fromVal.indexOf('::');
      if (ix > 0) {
        fromCat = fromVal.slice(0, ix);
        fromAccount = fromVal.slice(ix + 2);
      }
    }
    if (auto && (!fromCat || !fromAccount)) {
      alert('Pick a "From account" — auto-deduct needs somewhere to take the money from.');
      return;
    }
    const rate = getRates()[ccy as 'CHF'] || 1;
    onSave({
      ...sub,
      name: n,
      amount: aRaw / rate,
      period,
      renewal: renewal || null,
      entered_amount: aRaw,
      entered_currency: ccy,
      fromCat,
      fromAccount,
      autoDeduct: auto,
    });
  };

  return (
    <div className="mb-2 grid grid-cols-1 gap-2 rounded-xl border border-white/10 bg-black/30 p-3 sm:grid-cols-4">
      <SubFormFields
        {...{ accounts, name, setName, amount, setAmount, ccy, setCcy, period, setPeriod, renewal, setRenewal, fromVal, setFromVal, auto, setAuto }}
      />
      <div className="flex gap-2 sm:col-span-2">
        <GhostButton onClick={onCancel} className="flex-1 py-2 text-[12px]">
          Cancel
        </GhostButton>
        <button
          type="button"
          onClick={save}
          className="flex-1 cursor-pointer rounded-xl bg-white/[0.09] px-3 py-2 text-[12px] font-bold text-ink hover:bg-white/[0.14]"
        >
          Save
        </button>
      </div>
    </div>
  );
}

// ============================ orders ========================================
function ordFmtArrival(iso: string | null): { cls: string; label: string } | null {
  if (!iso) return null;
  const isoSafe = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00` : iso;
  const d = new Date(isoSafe);
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  const diffDays = Math.round(
    (new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() -
      new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) /
      86400000,
  );
  const dateLabel = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  if (diffDays < 0) return { cls: 'text-bad bg-bad/10', label: `late · ${dateLabel}` };
  if (diffDays === 0) return { cls: 'text-good bg-good/10', label: `today · ${dateLabel}` };
  if (diffDays === 1) return { cls: 'text-warn bg-warn/10', label: `tomorrow · ${dateLabel}` };
  if (diffDays <= 7) return { cls: 'text-warn bg-warn/10', label: `in ${diffDays}d · ${dateLabel}` };
  return { cls: 'text-ink-2 bg-white/[0.04]', label: dateLabel };
}

const ORD_BORDER: Record<string, string> = {
  bank: 'border-l-sky-300',
  stocks: 'border-l-good',
  crypto: 'border-l-warn',
  other: 'border-l-purple-300',
};

function OrdersTab({ money, orders, grand }: { money: (n: number) => string; orders: Order[]; grand: number }) {
  const accounts = listAllNwAccounts();
  const [name, setName] = React.useState('');
  const [cost, setCost] = React.useState('');
  const [ccy, setCcy] = React.useState('CHF');
  const [fromVal, setFromVal] = React.useState('');
  const [date, setDate] = React.useState('');
  const [chooserId, setChooserId] = React.useState<string | null>(null);

  const saveOrders = (next: Order[]) => storeSet('incoming_orders', next);

  const costRaw = parseFloat(cost);
  const rate = getRates()[ccy as 'CHF'] || 1;
  const previewCHF = !isNaN(costRaw) && costRaw > 0 ? costRaw / rate : null;
  const previewPct = previewCHF != null && grand > 0 ? (previewCHF / grand) * 100 : null;
  const fromName = fromVal.includes('::') ? fromVal.split('::')[1] : 'Bank';

  const add = () => {
    const n = name.trim();
    if (!n || isNaN(costRaw)) return;
    let fromCat = 'bank';
    let fromAccount: string | null = null;
    if (fromVal.includes('::')) {
      const ix = fromVal.indexOf('::');
      fromCat = fromVal.slice(0, ix);
      fromAccount = fromVal.slice(ix + 2);
    }
    saveOrders([
      ...orders,
      {
        id: `o_${Date.now()}_${Math.floor(Math.random() * 9999)}`,
        name: n,
        amount: costRaw / rate,
        entered_amount: costRaw,
        entered_currency: ccy,
        fromCat,
        fromAccount,
        date: date || null,
        ts: Date.now(),
        deductedAt: null,
        pctAtDeduction: null,
        deductedFrom: null,
      },
    ]);
    setName('');
    setCost('');
    setDate('');
  };

  const confirmDeduct = (orderId: string, catKey: string, itemName: string) => {
    const arr = storeGet<Order[]>('incoming_orders') || [];
    const oIdx = arr.findIndex((x) => x.id === orderId);
    if (oIdx < 0) return;
    const order = arr[oIdx];
    if (order.deductedAt) return;
    const items = getNwItems(catKey);
    const itemIdx = items.findIndex((it) => String(it.name) === String(itemName));
    if (itemIdx < 0) {
      alert('That account no longer exists. Refresh the chooser.');
      return;
    }
    const costCHF = Number(order.amount) || 0;
    const grandBefore = nwGrandCHF();
    items[itemIdx].amount = (Number(items[itemIdx].amount) || 0) - costCHF;
    storeSet(`nw:${catKey}`, items);
    logActivity(catKey, items[itemIdx].name, -costCHF, 'edit');
    arr[oIdx] = {
      ...order,
      deductedAt: Date.now(),
      pctAtDeduction: grandBefore > 0 ? (costCHF / grandBefore) * 100 : 0,
      deductedFrom: { cat: catKey, name: items[itemIdx].name },
    };
    saveOrders(arr);
    setChooserId(null);
  };

  const undoDeduct = (orderId: string) => {
    const arr = storeGet<Order[]>('incoming_orders') || [];
    const oIdx = arr.findIndex((x) => x.id === orderId);
    if (oIdx < 0) return;
    const order = arr[oIdx];
    if (!order.deductedAt || !order.deductedFrom) return;
    const costCHF = Number(order.amount) || 0;
    const items = getNwItems(order.deductedFrom.cat);
    const itemIdx = items.findIndex((it) => String(it.name) === String(order.deductedFrom!.name));
    if (itemIdx >= 0) {
      items[itemIdx].amount = (Number(items[itemIdx].amount) || 0) + costCHF;
      storeSet(`nw:${order.deductedFrom.cat}`, items);
      logActivity(order.deductedFrom.cat, items[itemIdx].name, costCHF, 'edit');
    }
    arr[oIdx] = { ...order, deductedAt: null, pctAtDeduction: null, deductedFrom: null };
    saveOrders(arr);
  };

  const sorted = orders.slice().sort((a, b) => {
    if (!a.date) return 1;
    if (!b.date) return -1;
    return a.date.localeCompare(b.date);
  });

  return (
    <>
      {/* add form */}
      <Card className="border border-white/[0.05] bg-white/[0.025]">
        <Eyebrow className="mb-2.5">+ NEW ORDER</Eyebrow>
        <div className="grid grid-cols-1 gap-2 rounded-xl bg-black/30 p-2 sm:grid-cols-[1.6fr_1fr_0.8fr]">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="Item (e.g. New iPhone)" className="min-w-0 text-[13px]" />
          <TextInput type="number" step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="Cost" className="min-w-0 text-right text-[13px]" />
          <SelectInput value={ccy} onChange={(e) => setCcy(e.target.value)} className="text-[12px]">
            {CCYS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </SelectInput>
          <SelectInput value={fromVal} onChange={(e) => setFromVal(e.target.value)} disabled={!accounts.length} title="Which net worth account this comes out of" className="text-[12px]">
            {!accounts.length ? (
              <option value="">No accounts yet</option>
            ) : (
              accounts.map((a) => (
                <option key={`${a.catKey}::${a.itemName}`} value={`${a.catKey}::${a.itemName}`}>
                  {CAT_ICON[a.catKey]} {a.itemName}
                </option>
              ))
            )}
          </SelectInput>
          <label className="flex min-w-0 cursor-pointer items-center gap-2 rounded-xl border border-white/[0.09] bg-black/30 px-3 py-2" title="Expected arrival">
            <span aria-hidden>📅</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none" />
          </label>
          <button
            type="button"
            onClick={add}
            className="cursor-pointer rounded-lg bg-gradient-to-b from-[#6EE7B7] to-[#4ED4A0] px-3.5 py-2 text-[13px] font-bold text-[#04201A] shadow-[0_4px_14px_rgba(110,231,183,0.22)] transition-transform hover:-translate-y-px active:scale-[0.97]"
          >
            + Add Order
          </button>
        </div>
        <div
          className={`mt-2.5 rounded-lg border px-3 py-2 font-mono text-[12px] ${
            previewPct == null
              ? 'border-good/[0.14] bg-good/[0.06] text-ink-2'
              : pctClass(previewPct) === 'good'
                ? 'border-good/[0.14] bg-good/[0.06] text-ink-2'
                : pctClass(previewPct) === 'warn'
                  ? 'border-warn/20 bg-warn/[0.08] text-warn'
                  : 'border-bad/20 bg-bad/[0.08] text-bad'
          }`}
        >
          {previewCHF == null
            ? 'Type a cost — preview will show what % of net worth it takes.'
            : grand > 0
              ? `${money(previewCHF)} from ${fromName} · ${previewPct!.toFixed(2)}% of your ${money(grand)} net worth`
              : `${money(previewCHF)} from ${fromName} · add net worth first to see %`}
        </div>
      </Card>

      <div className="flex items-baseline justify-between px-1">
        <span className="font-mono text-[10px] font-extrabold uppercase tracking-[0.18em] text-ink-3">Items on the way</span>
        <span className="font-mono text-[11px] tabular-nums text-ink-3">
          {orders.length} item{orders.length === 1 ? '' : 's'}
        </span>
      </div>

      {!orders.length ? (
        <div className="rounded-[14px] border border-dashed border-white/[0.08] bg-white/[0.025] px-5 py-8 text-center">
          <div className="mb-2 text-[34px] opacity-60" aria-hidden>
            📦
          </div>
          <div className="mb-1 text-[15px] font-bold text-ink">Nothing on the way</div>
          <div className="mx-auto max-w-[360px] text-[12px] leading-relaxed text-ink-3">
            Log an order above. Pick the account it comes out of, the expected arrival date, and the dashboard
            will show what % of your net worth it costs.
          </div>
        </div>
      ) : (
        sorted.map((o) => {
          const costCHF = Number(o.amount) || 0;
          const isDeducted = !!o.deductedAt;
          let pctText = '— of NW';
          let pctCls = 'text-ink-2';
          let frozen = false;
          if (isDeducted && typeof o.pctAtDeduction === 'number') {
            pctText = `${o.pctAtDeduction.toFixed(2)}% of NW`;
            pctCls = PCT_TXT[pctClass(o.pctAtDeduction)];
            frozen = true;
          } else if (grand > 0) {
            const pct = (costCHF / grand) * 100;
            pctText = `${pct.toFixed(2)}% of NW`;
            pctCls = PCT_TXT[pctClass(pct)];
          }
          const arr = ordFmtArrival(o.date);
          const fromLabel = o.fromAccount || NW_CATS.find((c) => c.key === o.fromCat)?.label.split(' ')[0] || 'Bank';
          return (
            <div
              key={o.id}
              className={`rounded-[14px] border-l-[3px] bg-white/[0.025] px-4 py-3.5 transition-colors hover:bg-white/[0.045] ${
                ORD_BORDER[o.fromCat] || 'border-l-ink-3'
              } ${isDeducted ? 'opacity-85' : ''}`}
            >
              <div className="grid grid-cols-[1fr_auto_auto] items-baseline gap-3">
                <span className={`truncate text-[15px] font-bold text-ink ${isDeducted ? 'line-through decoration-white/20' : ''}`}>
                  {o.name}
                </span>
                <span className="whitespace-nowrap font-mono text-[16px] font-bold text-ink tabular-nums">{money(costCHF)}</span>
                <button
                  type="button"
                  aria-label="Remove"
                  onClick={() => saveOrders(orders.filter((x) => x.id !== o.id))}
                  className="cursor-pointer rounded-md border border-white/[0.08] px-2 py-1 text-ink-3 hover:text-bad"
                >
                  <X size={13} aria-hidden />
                </button>
              </div>
              <div className="mt-2 flex flex-wrap gap-2 font-mono text-[11px] text-ink-3">
                <span className="inline-flex items-center rounded-full bg-white/[0.04] px-2 py-0.5 font-bold tracking-[0.04em] text-ink-2">
                  from · {fromLabel}
                </span>
                <span className={`inline-flex items-center rounded-full bg-white/[0.04] px-2 py-0.5 font-bold tracking-[0.04em] ${pctCls} ${frozen ? 'italic' : ''}`}>
                  {pctText}
                  {frozen ? ' · frozen' : ''}
                </span>
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 font-bold tracking-[0.04em] ${arr ? arr.cls : 'bg-white/[0.04] text-ink-2'}`}>
                  {arr ? arr.label : 'no arrival'}
                </span>
              </div>
              <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-dashed border-white/[0.06] pt-2.5">
                {isDeducted ? (
                  <>
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-good/20 bg-good/10 px-2.5 py-1 font-mono text-[11px] font-bold uppercase tracking-[0.06em] text-good">
                      ✓ Deducted from {o.deductedFrom?.name || fromLabel}
                    </span>
                    <button
                      type="button"
                      onClick={() => undoDeduct(o.id)}
                      className="cursor-pointer rounded-md border border-white/10 px-2 py-1 text-[10.5px] uppercase tracking-[0.06em] text-ink-3 hover:border-white/20 hover:text-ink"
                    >
                      Undo
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setChooserId(chooserId === o.id ? null : o.id)}
                    className="cursor-pointer rounded-lg border border-sky-300/30 bg-gradient-to-b from-sky-300/[0.18] to-sky-300/[0.08] px-3 py-1.5 text-[11.5px] font-bold uppercase tracking-[0.06em] text-sky-200 transition-transform hover:-translate-y-px active:scale-[0.97]"
                  >
                    − Deduct from net worth
                  </button>
                )}
              </div>
              {chooserId === o.id && !isDeducted && (
                <div className="mt-2.5 rounded-[10px] border border-sky-300/[0.18] bg-black/30 p-3">
                  <div className="mb-2 font-mono text-[10px] font-extrabold uppercase tracking-[0.18em] text-ink-3">
                    Deduct {money(costCHF)} from…
                  </div>
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {accounts.map((a) => {
                      const insufficient = a.amountCHF < costCHF - 0.005;
                      return (
                        <button
                          key={`${a.catKey}::${a.itemName}`}
                          type="button"
                          onClick={() => {
                            if (insufficient && !window.confirm("That account doesn't have enough — deduct anyway? (it will go negative)"))
                              return;
                            confirmDeduct(o.id, a.catKey, a.itemName);
                          }}
                          className={`cursor-pointer rounded-lg border border-white/[0.06] bg-white/[0.04] px-3 py-1.5 text-left text-[12px] font-semibold text-ink transition-colors hover:border-sky-300/30 hover:bg-sky-300/10 ${
                            insufficient ? 'opacity-45' : ''
                          }`}
                        >
                          {CAT_ICON[a.catKey]} {a.itemName}
                          <span className="block font-mono text-[10px] font-medium tracking-[0.04em] text-ink-3">
                            {money(a.amountCHF)}
                            {insufficient ? ' · not enough' : ' available'}
                          </span>
                        </button>
                      );
                    })}
                    {!accounts.length && (
                      <span className="text-[12px] text-ink-3">Add at least one net worth account before deducting.</span>
                    )}
                  </div>
                  <button type="button" onClick={() => setChooserId(null)} className="cursor-pointer text-[11px] text-ink-3 underline">
                    cancel
                  </button>
                </div>
              )}
            </div>
          );
        })
      )}
    </>
  );
}

// ============================ wishlist ======================================
function WishTab({ money, wishes, grand }: { money: (n: number) => string; wishes: Wish[]; grand: number }) {
  const [name, setName] = React.useState('');
  const [amount, setAmount] = React.useState('');
  const [ccy, setCcy] = React.useState('CHF');

  const total = wishes.reduce((s, it) => s + (Number(it.amount) || 0), 0);
  const pct = grand > 0 ? (total / grand) * 100 : null;
  const cls = pct == null ? null : pctClass(pct);

  const add = () => {
    const n = name.trim();
    const aRaw = parseFloat(amount);
    if (!n || isNaN(aRaw)) return;
    const rate = getRates()[ccy as 'CHF'] || 1;
    storeSet('wishlist', [
      ...wishes,
      { name: n, amount: aRaw / rate, ts: Date.now(), entered_amount: aRaw, entered_currency: ccy },
    ]);
    setName('');
    setAmount('');
  };

  const sorted = wishes
    .map((it, idx) => ({ it, idx }))
    .sort((a, b) => (b.it.amount || 0) - (a.it.amount || 0));

  return (
    <>
      {/* hero */}
      <Card className="relative overflow-hidden border border-purple-300/[0.18] bg-gradient-to-br from-purple-300/[0.08] to-good/[0.04]">
        <div className="mb-3.5 flex items-end justify-between gap-4">
          <div>
            <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-ink-3">WISHLIST TOTAL</div>
            <div className="font-mono text-[30px] font-bold leading-none tracking-tight text-ink tabular-nums">
              {money(total)}
            </div>
          </div>
          <div className="text-right">
            <div className="mb-1 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-ink-3">% OF NET WORTH</div>
            <div
              className={`font-mono text-[21px] font-bold tabular-nums ${
                cls === 'warn' ? 'text-warn' : cls === 'bad' ? 'text-bad' : 'text-purple-300'
              }`}
            >
              {pct == null ? '—' : `${pct.toFixed(2)}%`}
            </div>
          </div>
        </div>
        <div className="h-1.5 overflow-hidden rounded-[3px] bg-white/[0.06]">
          <div
            className="h-full rounded-[3px] bg-gradient-to-r from-purple-300 to-good shadow-[0_0_8px_rgba(183,148,244,0.5)] transition-all"
            style={{ width: `${Math.min(100, pct ?? 0)}%` }}
          />
        </div>
        <div className="mt-2.5 font-mono text-[11.5px] text-ink-3">
          {pct == null
            ? 'Add accounts in Net Worth first to see this as a %'
            : `Your wishlist is ${pct.toFixed(2)}% of your ${money(grand)} net worth`}
        </div>
      </Card>

      {/* add */}
      <Card className="border border-white/[0.05] bg-white/[0.025]">
        <Eyebrow className="mb-2.5">+ ADD AN ITEM</Eyebrow>
        <div className="flex flex-wrap items-stretch gap-1.5 rounded-xl bg-black/30 p-2">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="Item name (e.g. New iPhone Pro Max)" className="min-w-[160px] flex-[2] text-[14px]" />
          <TextInput type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="Cost" className="min-w-[80px] max-w-[110px] flex-1 text-right text-[14px]" />
          <SelectInput value={ccy} onChange={(e) => setCcy(e.target.value)} className="text-[12px]">
            {CCYS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </SelectInput>
          <button
            type="button"
            onClick={add}
            className="cursor-pointer rounded-lg bg-gradient-to-b from-[#B794F4] to-[#9F7DD4] px-4 py-2 text-[14px] font-bold text-white shadow-[0_4px_14px_rgba(183,148,244,0.3)] transition-transform hover:-translate-y-px active:scale-[0.97]"
          >
            + Add
          </button>
        </div>
      </Card>

      <div className="flex items-baseline justify-between px-1">
        <span className="font-mono text-[10px] font-extrabold uppercase tracking-[0.18em] text-ink-3">Your wishes</span>
        <span className="font-mono text-[11px] tabular-nums text-ink-3">
          {wishes.length} item{wishes.length === 1 ? '' : 's'}
        </span>
      </div>

      {!wishes.length ? (
        <div className="rounded-[14px] border border-dashed border-white/[0.08] bg-white/[0.025] px-5 py-8 text-center">
          <div className="mb-2 text-[34px] opacity-60" aria-hidden>
            🎯
          </div>
          <div className="mb-1 text-[15px] font-bold text-ink">No wishes yet</div>
          <div className="mx-auto max-w-[320px] text-[12px] leading-relaxed text-ink-3">
            Add anything you're saving for — the dashboard will calculate what % of your net worth it'd cost.
          </div>
        </div>
      ) : (
        sorted.map(({ it, idx }) => {
          const cost = Number(it.amount) || 0;
          const itemPct = grand > 0 ? (cost / grand) * 100 : null;
          const itemCls = itemPct == null ? 'flat' : pctClass(itemPct);
          const fillPct = Math.min(100, itemPct ?? 0);
          const barCls =
            itemCls === 'good'
              ? 'bg-good shadow-[0_0_6px_rgba(107,227,164,0.5)]'
              : itemCls === 'warn'
                ? 'bg-warn shadow-[0_0_6px_rgba(242,192,99,0.5)]'
                : itemCls === 'bad'
                  ? 'bg-bad shadow-[0_0_6px_rgba(255,138,138,0.5)]'
                  : 'bg-white/20';
          return (
            <div key={`${it.ts}-${idx}`} className="rounded-xl bg-white/[0.025] px-3.5 py-3">
              <div className="grid grid-cols-[1fr_auto_auto] items-center gap-3">
                <div className="min-w-0">
                  <div className="text-[14px] font-semibold text-ink">{it.name}</div>
                  <div className="mt-0.5 font-mono text-[11px] text-ink-3">
                    {it.entered_currency || 'CHF'}{' '}
                    {Number(it.entered_amount != null ? it.entered_amount : it.amount).toLocaleString('en-US', {
                      maximumFractionDigits: 2,
                    })}{' '}
                    · added {fmtActivityDate(it.ts || Date.now())}
                  </div>
                </div>
                <div className="text-right leading-tight">
                  <div className="font-mono text-[16px] font-bold text-ink tabular-nums">{money(cost)}</div>
                  <div className={`mt-0.5 font-mono text-[10.5px] font-bold uppercase tracking-[0.04em] ${itemCls === 'flat' ? 'text-ink-3' : PCT_TXT[itemCls]}`}>
                    {itemPct == null ? '—' : `${itemPct.toFixed(2)}%`} of NW
                  </div>
                </div>
                <button
                  type="button"
                  aria-label="Remove"
                  onClick={() => storeSet('wishlist', wishes.filter((_, j) => j !== idx))}
                  className="cursor-pointer rounded-md border border-white/10 px-2 py-1 text-ink-3 hover:text-bad"
                >
                  <X size={13} aria-hidden />
                </button>
              </div>
              <div className="mt-2.5 h-[5px] overflow-hidden rounded-[3px] bg-white/[0.04]">
                <div className={`h-full rounded-[3px] transition-all ${barCls}`} style={{ width: `${fillPct}%` }} />
              </div>
            </div>
          );
        })
      )}
    </>
  );
}
