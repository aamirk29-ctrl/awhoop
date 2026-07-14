'use client';

// Food logging: USDA search (with a serving-size converter) + a manual fallback,
// and today's editable log. Everything writes through lib/food.ts.

import * as React from 'react';
import { Check, Loader2, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import type { BentoAccent } from '@/components/ui/aurora-bento-grid';
import { addEntry, removeEntry, updateEntry, type FoodEntry } from '@/lib/food';
import {
  UsdaNotConfigured,
  getFood,
  macrosForGrams,
  searchFoods,
  type UsdaFood,
} from '@/lib/usda';
import {
  Card,
  Eyebrow,
  EmptyState,
  GhostButton,
  PrimaryButton,
  Seg,
  SelectInput,
  TextInput,
} from './shared';

const r0 = (n: number) => Math.round(n);
const r1 = (n: number) => Math.round(n * 10) / 10;

export default function FoodLogger({
  entries,
  accent,
}: {
  entries: FoodEntry[];
  accent: BentoAccent;
}) {
  const [mode, setMode] = React.useState<'search' | 'manual'>('search');

  return (
    <>
      <Card>
        <Eyebrow className="mb-3">LOG FOOD</Eyebrow>
        <Seg
          options={[
            { value: 'search', label: 'USDA search' },
            { value: 'manual', label: 'Manual entry' },
          ]}
          value={mode}
          onChange={setMode}
          className="mb-4"
        />
        {mode === 'search' ? <UsdaSearch accent={accent} /> : <ManualEntry accent={accent} />}
      </Card>

      <Card>
        <Eyebrow className="mb-3">TODAY&rsquo;S LOG</Eyebrow>
        <TodaysLog entries={entries} accent={accent} />
      </Card>
    </>
  );
}

// ---- USDA search ------------------------------------------------------------

function UsdaSearch({ accent }: { accent: BentoAccent }) {
  const [query, setQuery] = React.useState('');
  const [results, setResults] = React.useState<UsdaFood[] | null>(null);
  const [selected, setSelected] = React.useState<UsdaFood | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [notConfigured, setNotConfigured] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const run = async () => {
    const q = query.trim();
    if (!q) return;
    setLoading(true);
    setError(null);
    setSelected(null);
    try {
      setResults(await searchFoods(q));
    } catch (e) {
      if (e instanceof UsdaNotConfigured) setNotConfigured(e.message);
      else setError(e instanceof Error ? e.message : String(e));
      setResults(null);
    } finally {
      setLoading(false);
    }
  };

  const select = async (f: UsdaFood) => {
    setLoading(true);
    try {
      // Search results omit foodPortions — refetch for the full portion list.
      setSelected(await getFood(f.fdcId));
    } catch {
      setSelected(f); // fall back to the search-result nutrients
    } finally {
      setLoading(false);
    }
  };

  if (notConfigured) {
    return (
      <div className="rounded-[10px] border border-warn/25 bg-warn/10 px-3.5 py-3">
        <div className="text-[12.5px] font-semibold text-warn">USDA search not configured</div>
        <p className="mt-1 text-[11.5px] leading-snug text-ink-2">{notConfigured}</p>
        <p className="mt-1.5 text-[11.5px] leading-snug text-ink-3">
          Manual entry works fine in the meantime — switch tabs above.
        </p>
      </div>
    );
  }

  if (selected) {
    return <PortionPicker food={selected} accent={accent} onDone={() => setSelected(null)} />;
  }

  return (
    <>
      <div className="flex gap-2">
        <TextInput
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && run()}
          placeholder="Search a food (chicken breast, oats…)"
          className="min-w-0 flex-1"
          autoComplete="off"
        />
        <PrimaryButton onClick={run} disabled={loading || !query.trim()} aria-label="Search">
          {loading ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
        </PrimaryButton>
      </div>

      {error && (
        <div className="mt-2.5 rounded-[10px] border border-bad/25 bg-bad/10 px-3 py-2 font-mono text-[11px] text-bad">
          {error}
        </div>
      )}

      {results && (
        <div className="mt-3 flex flex-col gap-1.5">
          {results.length === 0 ? (
            <EmptyState>No matches — try manual entry.</EmptyState>
          ) : (
            results.map((f) => (
              <button
                key={f.fdcId}
                type="button"
                onClick={() => select(f)}
                className="flex cursor-pointer flex-col gap-1 rounded-[10px] border border-white/[0.07] bg-white/[0.025] px-3 py-2.5 text-left transition-colors hover:bg-white/[0.06]"
              >
                <span className="flex items-start gap-2">
                  <span className="min-w-0 flex-1 text-[13px] font-semibold leading-snug text-ink">
                    {f.name}
                  </span>
                  {f.dataType && <DataTypeTag dataType={f.dataType} />}
                </span>
                <span className="font-mono text-[10.5px] text-ink-3">
                  {r0(f.per100g.kcal)} kcal · {r1(f.per100g.protein)}g protein / 100g
                  {f.brand ? ` · ${f.brand}` : ''}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </>
  );
}

/** USDA lab analyses (Foundation / SR Legacy) are trustworthy; Branded entries are
 *  self-reported label data and disagree wildly with each other. Worth showing. */
function DataTypeTag({ dataType }: { dataType: string }) {
  const usdaMeasured = dataType === 'Foundation' || dataType === 'SR Legacy';
  return (
    <span
      className={`shrink-0 rounded-full border px-1.5 py-0.5 font-mono text-[8.5px] font-bold uppercase tracking-[0.1em] ${
        usdaMeasured
          ? 'border-good/30 bg-good/10 text-good'
          : 'border-white/[0.09] bg-white/[0.04] text-ink-4'
      }`}
    >
      {usdaMeasured ? 'USDA' : 'Label'}
    </span>
  );
}

/** Serving-size converter — pick a portion, scale per-100g nutrients to it. */
function PortionPicker({
  food,
  accent,
  onDone,
}: {
  food: UsdaFood;
  accent: BentoAccent;
  onDone: () => void;
}) {
  const [portionIdx, setPortionIdx] = React.useState(0);
  const [qty, setQty] = React.useState(1);

  const portion = food.portions[portionIdx] ?? food.portions[0];
  const grams = portion.grams * (qty || 0);
  const macros = macrosForGrams(food.per100g, grams);

  const label = `${qty % 1 === 0 ? qty : r1(qty)} × ${portion.label} (${r0(grams)} g)`;

  const log = () => {
    addEntry({
      name: food.name,
      servingLabel: label,
      kcal: r0(macros.kcal),
      protein: r1(macros.protein),
      carbs: r1(macros.carbs),
      fat: r1(macros.fat),
      source: 'usda',
      fdcId: food.fdcId,
    });
    onDone();
  };

  return (
    <div className="rounded-[10px] border border-white/[0.09] bg-white/[0.025] p-3.5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13.5px] font-semibold leading-snug text-ink">{food.name}</div>
          {food.brand && <div className="mt-0.5 font-mono text-[10.5px] text-ink-3">{food.brand}</div>}
        </div>
        <button
          type="button"
          onClick={onDone}
          aria-label="Back to results"
          className="cursor-pointer text-ink-4 transition-colors hover:text-ink"
        >
          <X size={16} aria-hidden />
        </button>
      </div>

      <div className="grid grid-cols-[80px_1fr] gap-2.5">
        <label className="flex flex-col gap-1.5">
          <span className="text-[10.5px] font-bold uppercase tracking-[0.06em] text-ink-3">Qty</span>
          <TextInput
            type="number"
            min={0}
            step={0.25}
            value={qty}
            onChange={(e) => setQty(parseFloat(e.target.value) || 0)}
          />
        </label>
        <label className="flex min-w-0 flex-col gap-1.5">
          <span className="text-[10.5px] font-bold uppercase tracking-[0.06em] text-ink-3">Serving</span>
          <SelectInput value={portionIdx} onChange={(e) => setPortionIdx(Number(e.target.value))}>
            {food.portions.map((p, i) => (
              <option key={`${p.label}-${i}`} value={i}>
                {p.label} · {r0(p.grams)} g
              </option>
            ))}
          </SelectInput>
        </label>
      </div>

      <div className="mt-3 grid grid-cols-4 gap-1.5">
        <MacroChip label="kcal" value={r0(macros.kcal)} highlight={accent.text} />
        <MacroChip label="protein" value={`${r1(macros.protein)}g`} />
        <MacroChip label="carbs" value={`${r1(macros.carbs)}g`} />
        <MacroChip label="fat" value={`${r1(macros.fat)}g`} />
      </div>

      {food.kcalDerived && (
        <p className="mt-2 text-[11px] leading-snug text-ink-3">
          USDA publishes no calorie figure for this food — kcal is calculated from its protein,
          carbs and fat (4/4/9). Macros are measured; energy is an estimate.
        </p>
      )}

      <PrimaryButton onClick={log} disabled={grams <= 0} className="mt-3 w-full">
        <span className="inline-flex items-center justify-center gap-1.5">
          <Plus size={14} aria-hidden /> Log {r0(grams)} g
        </span>
      </PrimaryButton>
    </div>
  );
}

function MacroChip({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string | number;
  highlight?: string;
}) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-black/20 px-2 py-2 text-center">
      <div
        className="font-mono text-[15px] font-bold leading-none tabular-nums"
        style={{ color: highlight || undefined }}
      >
        {value}
      </div>
      <div className="mt-1 font-mono text-[9.5px] uppercase tracking-[0.1em] text-ink-3">{label}</div>
    </div>
  );
}

// ---- manual entry -----------------------------------------------------------

function ManualEntry({ accent }: { accent: BentoAccent }) {
  const blank = { name: '', servingLabel: '', kcal: '', protein: '', carbs: '', fat: '' };
  const [f, setF] = React.useState(blank);

  const num = (v: string) => parseFloat(v) || 0;
  const valid = f.name.trim() !== '' && f.kcal.trim() !== '';

  const log = () => {
    if (!valid) return;
    addEntry({
      name: f.name.trim(),
      servingLabel: f.servingLabel.trim() || '1 serving',
      kcal: num(f.kcal),
      protein: num(f.protein),
      carbs: f.carbs.trim() ? num(f.carbs) : undefined,
      fat: f.fat.trim() ? num(f.fat) : undefined,
      source: 'manual',
    });
    setF(blank);
  };

  return (
    <div className="flex flex-col gap-2.5">
      <div className="grid grid-cols-2 gap-2.5">
        <Labeled label="Food" className="col-span-2">
          <TextInput
            value={f.name}
            onChange={(e) => setF({ ...f, name: e.target.value })}
            placeholder="e.g. Protein shake"
          />
        </Labeled>
        <Labeled label="Serving (optional)" className="col-span-2">
          <TextInput
            value={f.servingLabel}
            onChange={(e) => setF({ ...f, servingLabel: e.target.value })}
            placeholder="e.g. 1 scoop, 250 ml"
          />
        </Labeled>
        <Labeled label="Calories *">
          <TextInput
            type="number"
            min={0}
            value={f.kcal}
            onChange={(e) => setF({ ...f, kcal: e.target.value })}
            placeholder="kcal"
          />
        </Labeled>
        <Labeled label="Protein (g)">
          <TextInput
            type="number"
            min={0}
            step={0.1}
            value={f.protein}
            onChange={(e) => setF({ ...f, protein: e.target.value })}
            placeholder="g"
          />
        </Labeled>
        <Labeled label="Carbs (g)">
          <TextInput
            type="number"
            min={0}
            step={0.1}
            value={f.carbs}
            onChange={(e) => setF({ ...f, carbs: e.target.value })}
            placeholder="optional"
          />
        </Labeled>
        <Labeled label="Fat (g)">
          <TextInput
            type="number"
            min={0}
            step={0.1}
            value={f.fat}
            onChange={(e) => setF({ ...f, fat: e.target.value })}
            placeholder="optional"
          />
        </Labeled>
      </div>
      <PrimaryButton onClick={log} disabled={!valid} className="w-full">
        <span className="inline-flex items-center justify-center gap-1.5">
          <Plus size={14} aria-hidden /> Add to log
        </span>
      </PrimaryButton>
      {!valid && (
        <p className="text-center text-[11px] italic text-ink-3">Food name and calories are required.</p>
      )}
    </div>
  );
}

function Labeled({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`flex flex-col gap-1.5 ${className || ''}`}>
      <span className="text-[10.5px] font-bold uppercase tracking-[0.06em] text-ink-3">{label}</span>
      {children}
    </label>
  );
}

// ---- today's log ------------------------------------------------------------

function TodaysLog({ entries, accent }: { entries: FoodEntry[]; accent: BentoAccent }) {
  const [editing, setEditing] = React.useState<string | null>(null);

  if (entries.length === 0) {
    return <EmptyState>Nothing logged yet today.</EmptyState>;
  }

  return (
    <div className="flex flex-col gap-1.5">
      {entries.map((e) =>
        editing === e.id ? (
          <EditRow key={e.id} entry={e} onDone={() => setEditing(null)} />
        ) : (
          <div
            key={e.id}
            className="flex items-center gap-2.5 rounded-[10px] border border-white/[0.06] bg-white/[0.025] px-3 py-2.5"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-semibold text-ink">{e.name}</div>
              <div className="mt-0.5 truncate font-mono text-[10.5px] text-ink-3">
                {e.servingLabel}
                {e.carbs != null || e.fat != null
                  ? ` · ${e.carbs != null ? `${r1(e.carbs)}c` : ''}${e.carbs != null && e.fat != null ? ' ' : ''}${e.fat != null ? `${r1(e.fat)}f` : ''}`
                  : ''}
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div
                className="font-mono text-[14px] font-bold leading-none tabular-nums"
                style={{ color: accent.text }}
              >
                {r0(e.kcal)}
              </div>
              <div className="mt-1 font-mono text-[10.5px] tabular-nums text-ink-3">
                {r1(e.protein)}g P
              </div>
            </div>
            <div className="flex shrink-0 gap-0.5">
              <IconBtn label="Edit" onClick={() => setEditing(e.id)}>
                <Pencil size={13} aria-hidden />
              </IconBtn>
              <IconBtn label="Delete" danger onClick={() => removeEntry(e.id)}>
                <Trash2 size={13} aria-hidden />
              </IconBtn>
            </div>
          </div>
        ),
      )}
    </div>
  );
}

function EditRow({ entry, onDone }: { entry: FoodEntry; onDone: () => void }) {
  const [name, setName] = React.useState(entry.name);
  const [kcal, setKcal] = React.useState(String(entry.kcal));
  const [protein, setProtein] = React.useState(String(entry.protein));

  const save = () => {
    updateEntry(entry.id, {
      name: name.trim() || entry.name,
      kcal: parseFloat(kcal) || 0,
      protein: parseFloat(protein) || 0,
    });
    onDone();
  };

  return (
    <div className="rounded-[10px] border border-white/[0.12] bg-white/[0.04] px-3 py-2.5">
      <TextInput value={name} onChange={(e) => setName(e.target.value)} className="mb-2 w-full" />
      <div className="flex gap-2">
        <TextInput
          type="number"
          min={0}
          value={kcal}
          onChange={(e) => setKcal(e.target.value)}
          className="min-w-0 flex-1"
          aria-label="Calories"
        />
        <TextInput
          type="number"
          min={0}
          step={0.1}
          value={protein}
          onChange={(e) => setProtein(e.target.value)}
          className="min-w-0 flex-1"
          aria-label="Protein grams"
        />
        <IconBtn label="Save" onClick={save}>
          <Check size={14} aria-hidden />
        </IconBtn>
        <IconBtn label="Cancel" onClick={onDone}>
          <X size={14} aria-hidden />
        </IconBtn>
      </div>
      <div className="mt-1.5 flex gap-2 font-mono text-[9.5px] uppercase tracking-[0.1em] text-ink-3">
        <span className="flex-1">kcal</span>
        <span className="flex-1">protein (g)</span>
        <span className="w-[72px]" />
      </div>
    </div>
  );
}

function IconBtn({
  label,
  onClick,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-white/[0.07] bg-white/[0.03] transition-colors ${
        danger ? 'text-ink-4 hover:bg-bad/15 hover:text-bad' : 'text-ink-3 hover:bg-white/[0.09] hover:text-ink'
      }`}
    >
      {children}
    </button>
  );
}
