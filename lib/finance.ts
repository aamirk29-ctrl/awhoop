// Finance model — same localStorage keys as finance.html (`nw:*`, `subs`,
// `incoming_orders`, `wishlist`, `nw_currency`, `nw:activity`, `nw:history`).
// All amounts are stored in CHF; display converts via lib/fx.

import { storeGet, storeSet } from './storage';

export type NwCatKey = 'bank' | 'stocks' | 'crypto' | 'other';

export const NW_CATS: { key: NwCatKey; label: string; icon: string; color: string }[] = [
  { key: 'bank', label: 'Bank accounts', icon: '🏦', color: '#7DD3FC' },
  { key: 'stocks', label: 'Stocks / Investments', icon: '📈', color: '#6EE7B7' },
  { key: 'crypto', label: 'Crypto', icon: '🪙', color: '#FBBF24' },
  { key: 'other', label: 'Other assets', icon: '💼', color: '#B794F4' },
];

export const SUBS_SLICE = { name: 'Subs/yr', color: '#FF8A8A' };

export type NwItem = { name: string; amount: number };

export type Sub = {
  name: string;
  amount: number;
  period: 'monthly' | 'yearly' | 'weekly';
  renewal: string | null;
  entered_amount?: number;
  entered_currency?: string;
  fromCat?: string | null;
  fromAccount?: string | null;
  autoDeduct?: boolean;
  lastDeductedAt?: number | null;
};

export type Order = {
  id: string;
  name: string;
  amount: number;
  entered_amount?: number;
  entered_currency?: string;
  fromCat: string;
  fromAccount?: string | null;
  date: string | null;
  ts: number;
  deductedAt?: number | null;
  pctAtDeduction?: number | null;
  deductedFrom?: { cat: string; name: string } | null;
};

export type Wish = {
  name: string;
  amount: number;
  ts: number;
  entered_amount?: number;
  entered_currency?: string;
};

export type Activity = { ts: number; cat: string; name: string; delta: number; kind: string };

export function getNwItems(cat: string): NwItem[] {
  return storeGet<NwItem[]>(`nw:${cat}`) || [];
}

export function nwGrandCHF(): number {
  let g = 0;
  NW_CATS.forEach((cat) => {
    getNwItems(cat.key).forEach((it) => {
      g += Number(it.amount) || 0;
    });
  });
  return g;
}

export function listAllNwAccounts() {
  const out: { catKey: NwCatKey; itemIdx: number; itemName: string; amountCHF: number }[] = [];
  NW_CATS.forEach((cat) => {
    getNwItems(cat.key).forEach((it, idx) => {
      out.push({ catKey: cat.key, itemIdx: idx, itemName: String(it.name || ''), amountCHF: Number(it.amount) || 0 });
    });
  });
  return out;
}

const ACTIVITY_KEY = 'nw:activity';
const ACTIVITY_MAX = 50;

export function logActivity(catKey: string, name: string, deltaCHF: number, kind: string) {
  const arr = storeGet<Activity[]>(ACTIVITY_KEY) || [];
  arr.push({ ts: Date.now(), cat: catKey, name: String(name || ''), delta: Number(deltaCHF) || 0, kind });
  if (arr.length > ACTIVITY_MAX) arr.splice(0, arr.length - ACTIVITY_MAX);
  storeSet(ACTIVITY_KEY, arr);
}

const NW_HISTORY_KEY = 'nw:history';
const NW_HISTORY_MAX = 500;

export function logNetWorthSnapshot(grandCHF: number) {
  const v = Number(grandCHF) || 0;
  const hist = storeGet<{ t: number; v: number }[]>(NW_HISTORY_KEY) || [];
  const last = hist[hist.length - 1];
  if (last && Math.abs((last.v || 0) - v) < 0.005) return;
  hist.push({ t: Date.now(), v });
  if (hist.length > NW_HISTORY_MAX) hist.splice(0, hist.length - NW_HISTORY_MAX);
  storeSet(NW_HISTORY_KEY, hist);
}

export function monthlyEquivalent(item: Sub): number {
  const a = Number(item.amount) || 0;
  if (item.period === 'yearly') return a / 12;
  if (item.period === 'weekly') return a * 4.345;
  return a;
}

// Roll a renewal date forward by its period until it's >= today.
export function nextRenewalDate(isoDate: string, period: string): Date | null {
  const isoSafe = /^\d{4}-\d{2}-\d{2}$/.test(isoDate) ? `${isoDate}T00:00` : isoDate;
  const d = new Date(isoSafe);
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let safety = 0;
  while (d < today && safety++ < 600) {
    if (period === 'weekly') d.setDate(d.getDate() + 7);
    else if (period === 'yearly') d.setFullYear(d.getFullYear() + 1);
    else d.setMonth(d.getMonth() + 1);
  }
  return d;
}

// Auto-deduct matured renewals from the linked account; idempotent via
// lastDeductedAt so refreshes never double-charge.
export function processAutoDeductSubs(): boolean {
  const items = storeGet<Sub[]>('subs') || [];
  if (!items.length) return false;
  const now = new Date();
  const todayMs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  let changed = false;
  items.forEach((it) => {
    if (!it.autoDeduct || !it.renewal || !it.fromCat || !it.fromAccount) return;
    const isoSafe = /^\d{4}-\d{2}-\d{2}$/.test(it.renewal) ? `${it.renewal}T00:00` : it.renewal;
    const renewalDate = new Date(isoSafe);
    if (isNaN(renewalDate.getTime())) return;
    let safety = 0;
    while (renewalDate.getTime() <= todayMs && safety++ < 200) {
      const renewalMs = new Date(
        renewalDate.getFullYear(),
        renewalDate.getMonth(),
        renewalDate.getDate(),
      ).getTime();
      if (!(it.lastDeductedAt && it.lastDeductedAt >= renewalMs)) {
        const nwItems = getNwItems(it.fromCat);
        const idx = nwItems.findIndex((x) => String(x.name) === String(it.fromAccount));
        if (idx < 0) break;
        const cost = Number(it.amount) || 0;
        nwItems[idx].amount = (Number(nwItems[idx].amount) || 0) - cost;
        storeSet(`nw:${it.fromCat}`, nwItems);
        logActivity(it.fromCat, nwItems[idx].name, -cost, 'edit');
        it.lastDeductedAt = renewalMs;
        changed = true;
      }
      if (it.period === 'weekly') renewalDate.setDate(renewalDate.getDate() + 7);
      else if (it.period === 'yearly') renewalDate.setFullYear(renewalDate.getFullYear() + 1);
      else renewalDate.setMonth(renewalDate.getMonth() + 1);
    }
    const newRenewal = `${renewalDate.getFullYear()}-${String(renewalDate.getMonth() + 1).padStart(2, '0')}-${String(renewalDate.getDate()).padStart(2, '0')}`;
    if (newRenewal !== it.renewal) {
      it.renewal = newRenewal;
      changed = true;
    }
  });
  if (changed) storeSet('subs', items);
  return changed;
}

export function pctClass(pct: number): 'good' | 'warn' | 'bad' {
  if (pct < 5) return 'good';
  if (pct < 25) return 'warn';
  return 'bad';
}

export function fmtActivityDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  if (dayStart === today) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (dayStart === today - 86400000) return 'yest';
  const mons = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${mons[d.getMonth()]} ${d.getDate()}`;
}
