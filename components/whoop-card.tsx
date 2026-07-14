'use client';

// WHOOP recovery/sleep/strain card — port of the health.html card.
// Auth, token storage and fetching all live in lib/whoop.ts, which is shared
// with the Nutrition panel. Refresh must stay single-sourced there: WHOOP
// rotates the refresh token on use, so a second refresh path would 401 both
// consumers out.

import * as React from 'react';
import { RefreshCw } from 'lucide-react';
import {
  buildAuthUrl,
  captureTokensFromHash,
  clearTokens,
  loadTokens,
  refreshWhoopEnergy,
  whoopFetch,
  type WhoopTokens,
} from '@/lib/whoop';
import { Card } from './panels/shared';

type WhoopData = {
  recScore: number | null;
  hrv: number | null;
  rhr: number | null;
  skin: number | null;
  spo2: number | null;
  sleepPerf: number | null;
  sleepDuration: number | null;
  resp: string | null;
  stages: { rem: number; deep: number; light: number; awake: number; total: number } | null;
  strain: number | null;
  kcal: number | null;
};

// ---- zone helpers (same thresholds as the old card) -------------------------
type Zone = 'good' | 'norm' | 'warn' | 'bad' | null;
const recoveryZone = (v: number | null): Zone => (v == null ? null : v >= 67 ? 'good' : v >= 34 ? 'warn' : 'bad');
const sleepZone = (p: number | null): Zone => (p == null ? null : p >= 85 ? 'good' : p >= 70 ? 'norm' : 'warn');
const strainZone = (s: number | null): Zone =>
  s == null ? null : s < 6 ? 'norm' : s < 14 ? 'good' : s < 18 ? 'warn' : 'bad';
const hrvZone = (h: number | null): Zone => (h == null ? null : h >= 60 ? 'good' : h >= 40 ? 'norm' : 'warn');
const rhrZone = (r: number | null): Zone => (r == null ? null : r <= 55 ? 'good' : r <= 70 ? 'norm' : 'warn');
const tempZone = (t: number | null): Zone =>
  t == null ? null : t >= 32.5 && t <= 34 ? 'good' : t >= 31 && t <= 35 ? 'norm' : 'warn';
const spo2Zone = (s: number | null): Zone =>
  s == null ? null : s >= 95 ? 'good' : s >= 92 ? 'norm' : s >= 88 ? 'warn' : 'bad';
const respZone = (r: number | null): Zone =>
  r == null ? null : r >= 12 && r <= 18 ? 'good' : r >= 10 && r <= 22 ? 'norm' : 'warn';

const ZONE_CLS: Record<string, string> = {
  good: 'bg-good shadow-[0_0_7px_rgba(107,227,164,0.55)]',
  norm: 'bg-white/30',
  warn: 'bg-warn shadow-[0_0_7px_rgba(242,192,99,0.55)]',
  bad: 'bg-bad shadow-[0_0_7px_rgba(255,138,138,0.55)]',
};

function ZoneDot({ zone, className }: { zone: Zone; className?: string }) {
  return (
    <span
      className={`inline-block h-[7px] w-[7px] rounded-full ${zone ? ZONE_CLS[zone] : 'bg-white/10'} ${className || ''}`}
      aria-hidden
    />
  );
}

const ringStroke = (score: number) => (score >= 67 ? '#6BE3A4' : score >= 34 ? '#F2C063' : '#FF8A8A');
const recoveryLabel = (score: number) =>
  score >= 67 ? 'Go hard today' : score >= 34 ? 'Moderate — listen to body' : 'Recover today';

function fmtMins(ms: number) {
  const m = Math.round(ms / 60000);
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}
function fmtMinsShort(ms: number) {
  const m = Math.round(ms / 60000);
  const h = Math.floor(m / 60);
  return `${h > 0 ? `${h}h ` : ''}${m % 60}m`;
}

export default function WhoopCard() {
  const [tokens, setTokens] = React.useState<WhoopTokens | null>(null);
  const [data, setData] = React.useState<WhoopData | null>(null);
  const [err, setErr] = React.useState('');
  const [updated, setUpdated] = React.useState('');
  const [spinning, setSpinning] = React.useState(false);
  const [ready, setReady] = React.useState(false);

  const loadData = React.useCallback(
    async () => {
      if (!loadTokens()?.access) return;
      setErr('');
      try {
        /* eslint-disable @typescript-eslint/no-explicit-any */
        const [rec, sleep, cycle] = await Promise.all([
          whoopFetch<any>('/recovery?limit=1').catch(() => null),
          whoopFetch<any>('/activity/sleep?limit=1').catch(() => null),
          whoopFetch<any>('/cycle?limit=1').catch(() => null),
        ]);
        const out: WhoopData = {
          recScore: null, hrv: null, rhr: null, skin: null, spo2: null,
          sleepPerf: null, sleepDuration: null, resp: null, stages: null,
          strain: null, kcal: null,
        };
        const r0: any = (rec as any)?.records?.[0];
        if (r0?.score) {
          out.recScore = Math.round(r0.score.recovery_score || 0);
          out.hrv = r0.score.hrv_rmssd_milli != null ? Math.round(r0.score.hrv_rmssd_milli) : null;
          out.rhr = r0.score.resting_heart_rate != null ? Math.round(r0.score.resting_heart_rate) : null;
          out.skin = r0.score.skin_temp_celsius ?? null;
          out.spo2 = r0.score.spo2_percentage ?? null;
        }
        const s0: any = (sleep as any)?.records?.[0];
        if (s0?.score) {
          out.sleepPerf = Math.round(s0.score.sleep_performance_percentage || 0);
          out.resp = s0.score.respiratory_rate != null ? Number(s0.score.respiratory_rate).toFixed(1) : null;
          const ss = s0.score.stage_summary;
          if (ss) {
            const inBed = ss.total_in_bed_time_milli || 0;
            const awake = ss.total_awake_time_milli || 0;
            out.sleepDuration = inBed - awake;
            const rem = ss.total_rem_sleep_time_milli || 0;
            const deep = ss.total_slow_wave_sleep_time_milli || 0;
            const light = ss.total_light_sleep_time_milli || 0;
            const total = rem + deep + light + awake;
            if (total > 0) out.stages = { rem, deep, light, awake, total };
          }
        }
        const c0: any = (cycle as any)?.records?.[0];
        if (c0?.score?.strain != null) {
          out.strain = Number(c0.score.strain);
          if (c0.score.kilojoule != null) out.kcal = Math.round(c0.score.kilojoule / 4.184);
        }
        /* eslint-enable @typescript-eslint/no-explicit-any */
        setData(out);
        setUpdated(`Updated ${new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    },
    [],
  );

  React.useEffect(() => {
    captureTokensFromHash();
    const t = loadTokens();
    setTokens(t);
    setReady(true);
    if (t?.access) loadData();
  }, [loadData]);

  const connect = () => {
    window.location.href = buildAuthUrl();
  };

  const disconnect = () => {
    clearTokens();
    setTokens(null);
    setData(null);
  };

  const refresh = async () => {
    setSpinning(true);
    try {
      // Keep the Nutrition panel's burn figure in step with this card.
      await Promise.all([loadData(), refreshWhoopEnergy().catch(() => null)]);
    } finally {
      setTimeout(() => setSpinning(false), 600);
    }
  };

  if (!ready) return null;

  if (!tokens?.access) {
    return (
      <Card className="rounded-[22px]">
        <div className="flex flex-col items-center gap-1.5 px-2 pb-2 pt-4 text-center">
          <Brand />
          <div className="mt-3 text-[21px] font-bold tracking-tight text-ink">Not connected</div>
          <div className="max-w-[280px] text-[13px] leading-relaxed text-ink-3">
            Link your account to see live recovery, sleep, and strain.
          </div>
          <button
            type="button"
            onClick={connect}
            className="mt-4 cursor-pointer rounded-full border border-white/85 bg-gradient-to-b from-white to-[#e8e5dd] px-5 py-3 text-[13.5px] font-bold text-[#0a0a0b] shadow-[inset_0_1px_0_rgba(255,255,255,0.55),0_6px_20px_rgba(0,0,0,0.45)] transition-transform hover:-translate-y-px"
          >
            Connect WHOOP
          </button>
        </div>
      </Card>
    );
  }

  const d = data;
  const C = 603.19;
  const verdict =
    d?.recScore == null
      ? null
      : d.recScore >= 67
        ? { cls: 'text-good border-good/50 bg-good/10', badge: 'GREEN', headline: "Push hard today. Body's primed — go for the PR, do the harder workout, take on the heavy task." }
        : d.recScore >= 34
          ? { cls: 'text-warn border-warn/50 bg-warn/10', badge: 'YELLOW', headline: "Moderate day. Train, but don't max out. Stick to planned volume, skip the max effort sets." }
          : { cls: 'text-bad border-bad/50 bg-bad/10', badge: 'RED', headline: 'Recover. Body is asking for rest — light movement, walk, mobility, sleep early.' };

  const reasons: string[] = [];
  if (d) {
    if (d.sleepPerf != null)
      reasons.push(`${d.sleepPerf >= 80 ? '✓' : '·'} Sleep score ${d.sleepPerf}% — ${d.sleepPerf >= 80 ? 'you slept well.' : 'sub-par sleep.'}`);
    if (d.strain != null)
      reasons.push(`${d.strain < 14 ? '·' : '✓'} Strain ${d.strain.toFixed(1)} yesterday — ${d.strain < 14 ? 'room to push today if recovery allows.' : 'high load logged.'}`);
    if (d.hrv != null)
      reasons.push(`${d.hrv >= 50 ? '✓' : '·'} HRV ${d.hrv}ms — ${d.hrv >= 50 ? 'strong autonomic state.' : 'autonomic stress.'}`);
    if (d.rhr != null)
      reasons.push(`${d.rhr <= 60 ? '✓' : '·'} RHR ${d.rhr}bpm — ${d.rhr <= 60 ? 'well-conditioned.' : 'elevated.'}`);
  }

  return (
    <Card className="rounded-[22px]">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2.5">
        <div className="inline-flex items-center gap-2">
          <Brand />
          <span className="ml-1 inline-flex items-center gap-1.5 rounded-full border border-good/30 bg-good/10 px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.16em] text-good">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-good shadow-[0_0_8px_rgba(107,227,164,0.65)]" />
            live
          </span>
        </div>
        <div className="flex items-center gap-2.5">
          <span className="font-mono text-[11px] text-ink-3">{updated || '—'}</span>
          <button
            type="button"
            onClick={refresh}
            aria-label="Refresh"
            className={`flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-white/[0.07] bg-white/[0.04] text-ink-2 transition-all hover:bg-white/10 hover:text-ink ${spinning ? 'animate-spin' : ''}`}
          >
            <RefreshCw size={13} aria-hidden />
          </button>
        </div>
      </div>

      {err && (
        <div className="mb-3.5 rounded-[10px] border border-bad/30 bg-bad/10 px-3 py-2.5 font-mono text-[11.5px] text-bad">
          {err}
        </div>
      )}

      {/* recovery ring */}
      <div className="relative mx-auto mb-6 aspect-square w-[230px] max-w-[78%]">
        <svg viewBox="0 0 220 220" className="h-full w-full -rotate-90" aria-hidden>
          <circle cx="110" cy="110" r="96" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="12" />
          <circle
            cx="110"
            cy="110"
            r="96"
            fill="none"
            stroke={d?.recScore != null ? ringStroke(d.recScore) : '#FFF'}
            strokeWidth="12"
            strokeLinecap="round"
            strokeDasharray={C}
            strokeDashoffset={d?.recScore != null ? C * (1 - d.recScore / 100) : C}
            style={{ transition: 'stroke-dashoffset 0.8s cubic-bezier(0.22,1,0.36,1), stroke 0.4s' }}
          />
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <div className="font-mono text-[56px] font-bold leading-none tracking-tight text-ink tabular-nums">
            {d?.recScore ?? '—'}
          </div>
          <div className="mt-2.5 text-[10px] font-bold uppercase tracking-[0.22em] text-ink-3">recovery</div>
          <div
            className="mt-1.5 text-[12.5px] font-semibold"
            style={{ color: d?.recScore != null ? ringStroke(d.recScore) : undefined }}
          >
            {d?.recScore != null ? recoveryLabel(d.recScore) : '—'}
          </div>
        </div>
      </div>

      {/* sleep stages */}
      {d?.stages && (
        <div className="mb-5 border-t border-white/[0.05] pt-5">
          <div className="mb-2.5 flex items-baseline justify-between">
            <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-ink-3">Sleep stages</span>
            <span className="font-mono text-[11px] text-ink-3">{fmtMins(d.stages.total)} total</span>
          </div>
          <div className="mb-3 flex h-2.5 overflow-hidden rounded-full border border-white/[0.04] bg-white/[0.04]">
            <div className="bg-white transition-all" style={{ width: `${(100 * d.stages.rem) / d.stages.total}%` }} />
            <div className="bg-[#B8B6B0] transition-all" style={{ width: `${(100 * d.stages.deep) / d.stages.total}%` }} />
            <div className="bg-[#76746E] transition-all" style={{ width: `${(100 * d.stages.light) / d.stages.total}%` }} />
            <div className="bg-[#38362F] transition-all" style={{ width: `${(100 * d.stages.awake) / d.stages.total}%` }} />
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(
              [
                ['REM', d.stages.rem, '#FFF'],
                ['Deep', d.stages.deep, '#B8B6B0'],
                ['Light', d.stages.light, '#76746E'],
                ['Awake', d.stages.awake, '#38362F'],
              ] as const
            ).map(([label, v, color]) => (
              <div key={label} className="flex items-center gap-1.5 text-[11px] font-medium text-ink-2">
                <span className="h-2 w-2 rounded-[2px]" style={{ background: color, border: color === '#38362F' ? '1px solid rgba(255,255,255,0.1)' : undefined }} />
                {label}
                <span className="ml-auto font-mono text-[11px] font-bold text-ink">{fmtMinsShort(v)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* stats */}
      <div className="grid grid-cols-2 gap-2 border-t border-white/[0.05] pt-5 sm:grid-cols-4">
        <Stat label="Sleep" value={d?.sleepPerf != null ? `${d.sleepPerf}%` : '—'} sub={d?.sleepDuration ? `${(d.sleepDuration / 3.6e6).toFixed(1)}h` : '—'} zone={sleepZone(d?.sleepPerf ?? null)} />
        <Stat label="Strain" value={d?.strain != null ? d.strain.toFixed(1) : '—'} sub={d?.kcal != null ? `${d.kcal} kcal` : 'today'} zone={strainZone(d?.strain ?? null)} />
        <Stat label="HRV" value={d?.hrv != null ? String(d.hrv) : '—'} sub="ms" zone={hrvZone(d?.hrv ?? null)} />
        <Stat label="RHR" value={d?.rhr != null ? String(d.rhr) : '—'} sub="bpm" zone={rhrZone(d?.rhr ?? null)} />
      </div>

      {/* biomarkers */}
      {d && (d.skin != null || d.spo2 != null || d.resp != null) && (
        <div className="mt-3 grid grid-cols-1 gap-2 min-[380px]:grid-cols-3">
          <Bio label="Skin temp" value={d.skin != null ? `${Number(d.skin).toFixed(1)}°C` : '—'} zone={tempZone(d.skin)} />
          <Bio label="Blood O₂" value={d.spo2 != null ? `${Number(d.spo2).toFixed(1)}%` : '—'} zone={spo2Zone(d.spo2)} />
          <Bio label="Resp rate" value={d.resp != null ? `${d.resp} br/min` : '—'} zone={respZone(d.resp != null ? Number(d.resp) : null)} />
        </div>
      )}

      {/* legend */}
      <div className="mt-3.5 flex flex-wrap justify-center gap-3.5 rounded-full border border-white/[0.04] bg-white/[0.02] px-3 py-2.5">
        {(
          [
            ['Good', 'good'],
            ['Normal', 'norm'],
            ['Watch', 'warn'],
            ['High / Low', 'bad'],
          ] as const
        ).map(([label, z]) => (
          <span key={z} className="inline-flex items-center gap-1.5 text-[10.5px] font-semibold text-ink-3">
            <ZoneDot zone={z} /> {label}
          </span>
        ))}
      </div>

      {/* today's call */}
      {verdict && (
        <div className="mt-4 rounded-r-xl border border-l-2 border-white/[0.04] border-l-white/40 bg-white/[0.025] px-4 py-4">
          <div className="mb-2.5 flex items-center gap-2.5">
            <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-ink-3">Today's call</span>
            <span className={`rounded-full border px-2 py-0.5 text-[9.5px] font-extrabold uppercase tracking-[0.14em] ${verdict.cls}`}>
              {verdict.badge}
            </span>
          </div>
          <div className="mb-3 text-[14.5px] font-semibold leading-normal text-ink">{verdict.headline}</div>
          <div className="text-[12.5px] leading-relaxed text-ink-2">
            {reasons.map((r, i) => (
              <div key={i}>{r}</div>
            ))}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={disconnect}
        className="mx-auto mt-4 block cursor-pointer px-3 py-1.5 text-[11px] text-ink-3 hover:text-ink-2 hover:underline"
      >
        Disconnect
      </button>
    </Card>
  );
}

function Brand() {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-white text-[12px] font-black tracking-tighter text-[#0a0a0b] shadow-[0_0_12px_rgba(255,255,255,0.2)]">
        W
      </span>
      <span className="text-[13px] font-extrabold tracking-[0.18em] text-ink">WHOOP</span>
    </span>
  );
}

function Stat({ label, value, sub, zone }: { label: string; value: string; sub: string; zone: Zone }) {
  return (
    <div className="relative rounded-xl border border-white/[0.04] bg-white/[0.025] px-2.5 py-3 text-center">
      <ZoneDot zone={zone} className="absolute right-2 top-2" />
      <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-ink-3">{label}</div>
      <div className="font-mono text-[21px] font-bold leading-none tracking-tight text-ink tabular-nums">{value}</div>
      <div className="mt-1.5 font-mono text-[10px] text-ink-3">{sub}</div>
    </div>
  );
}

function Bio({ label, value, zone }: { label: string; value: string; zone: Zone }) {
  return (
    <div className="relative rounded-xl border border-white/[0.04] bg-white/[0.025] px-3 py-2.5 text-center">
      <ZoneDot zone={zone} className="absolute right-2 top-2" />
      <span className="block text-[9.5px] font-bold uppercase tracking-[0.14em] text-ink-3">{label}</span>
      <span className="mt-1 block font-mono text-[14px] font-bold text-ink tabular-nums">{value}</span>
    </div>
  );
}
