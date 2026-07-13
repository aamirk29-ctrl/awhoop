'use client';

// Stack panel — WHOOP card on top, daily supplement stack below.
// Same keys as health.html: stack:items / stack:taken:DATE / stack:low.

import * as React from 'react';
import { X } from 'lucide-react';
import type { BentoAccent } from '@/components/ui/aurora-bento-grid';
import WhoopCard from '@/components/whoop-card';
import { storeGet, storeSet, useStorageTick } from '@/lib/storage';
import { activeDateKey } from '@/lib/dates';
import {
  STACK_DEFAULTS,
  STACK_WINDOWS,
  TEMPLATE_VERSION,
  searchSupplements,
  type StackItem,
  type StackWindowKey,
} from '@/lib/supplements';
import { Card, EmptyState, PrimaryButton, SectionTitle, SelectInput, TextInput } from './shared';

function getItems(): StackItem[] {
  const storedVersion = storeGet<number>('stack:version');
  const stored = storeGet<StackItem[]>('stack:items');
  if (!stored || !Array.isArray(stored) || !stored.length || storedVersion !== TEMPLATE_VERSION) {
    const fresh = JSON.parse(JSON.stringify(STACK_DEFAULTS)) as StackItem[];
    storeSet('stack:items', fresh);
    storeSet('stack:version', TEMPLATE_VERSION);
    return fresh;
  }
  return stored;
}

const takenKey = () => `stack:taken:${activeDateKey()}`;

export default function StackPanel({ accent }: { accent: BentoAccent }) {
  const tick = useStorageTick();
  const [, force] = React.useReducer((x: number) => x + 1, 0);
  React.useEffect(() => {
    const t = setInterval(force, 60 * 1000); // cutoff / rollover refresh
    return () => clearInterval(t);
  }, []);

  const items = React.useMemo(() => getItems(), [tick]);
  const taken = storeGet<Record<string, number>>(takenKey()) || {};
  const low = storeGet<string[]>('stack:low') || [];

  const takenCount = items.filter((i) => taken[i.id]).length;
  const pct = items.length === 0 ? 0 : (takenCount / items.length) * 100;

  const now = new Date();
  const nowHour = now.getHours() + now.getMinutes() / 60;

  const toggleTaken = (id: string) => {
    const t = { ...(storeGet<Record<string, number>>(takenKey()) || {}) };
    if (t[id]) delete t[id];
    else t[id] = Date.now();
    storeSet(takenKey(), t);
  };
  const toggleLow = (id: string) => {
    const l = storeGet<string[]>('stack:low') || [];
    storeSet('stack:low', l.includes(id) ? l.filter((x) => x !== id) : [...l, id]);
  };
  const deleteItem = (id: string) => {
    storeSet('stack:items', items.filter((i) => i.id !== id));
    const t = { ...(storeGet<Record<string, number>>(takenKey()) || {}) };
    delete t[id];
    storeSet(takenKey(), t);
    storeSet('stack:low', (storeGet<string[]>('stack:low') || []).filter((x) => x !== id));
  };
  const updateItem = (id: string, patch: Partial<StackItem>) => {
    storeSet('stack:items', items.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  };
  const addItem = (name: string, dose: string, windowKey: StackWindowKey, note: string) => {
    const v = name.trim();
    if (!v) return;
    storeSet('stack:items', [
      ...items,
      {
        id: `custom_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name: v,
        dose: dose.trim(),
        window: windowKey,
        note: note.trim(),
        tag: null,
        ordered: true,
      },
    ]);
  };

  // ticker issues
  const issues: { type: 'missed' | 'low'; text: string }[] = [];
  items.forEach((item) => {
    const win = STACK_WINDOWS.find((w) => w.key === (item.window || 'anytime'));
    const isPastCutoff = win && win.cutoffHour !== null && nowHour > win.cutoffHour;
    if (isPastCutoff && !taken[item.id])
      issues.push({ type: 'missed', text: `${item.name} — missed ${win!.title.toLowerCase()} dose` });
  });
  items.forEach((item) => {
    if (low.includes(item.id)) issues.push({ type: 'low', text: `${item.name} — running low, reorder soon` });
  });

  return (
    <div className="flex flex-col gap-4 pb-2 pt-2">
      <SectionTitle>Whoop</SectionTitle>
      <WhoopCard />

      <SectionTitle>Daily stack</SectionTitle>
      <Card>
        <StackTicker issues={issues} total={items.length} />

        <div className="mb-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-3">
          Daily stack
        </div>
        <div className="text-[22px] font-bold tracking-tight text-ink">Tap each as you take it</div>
        <div className="mt-1.5 font-mono text-[12px] tabular-nums text-ink-3">
          {takenCount} / {items.length} taken today · resets at 6 AM
        </div>

        <div className="my-4 h-[5px] overflow-hidden rounded-full bg-white/[0.05]">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${pct}%`,
              background: `linear-gradient(90deg, ${accent.from}, ${accent.to})`,
              boxShadow: `0 0 8px ${accent.from}55`,
            }}
          />
        </div>

        {items.length === 0 ? (
          <EmptyState>No items yet — add one below to start your stack.</EmptyState>
        ) : (
          STACK_WINDOWS.map((win) => {
            const winItems = items.filter((i) => (i.window || 'anytime') === win.key);
            if (!winItems.length) return null;
            const isPastCutoff = win.cutoffHour !== null && nowHour > win.cutoffHour;
            return (
              <div key={win.key} className="mb-3.5">
                <div className="mb-2 flex items-center gap-2 border-b border-white/[0.04] pb-1.5">
                  <span className="text-[15px]" aria-hidden>
                    {win.icon}
                  </span>
                  <span className="text-[13px] font-bold text-ink">{win.title}</span>
                  <span className="text-[11px] font-medium text-ink-3">{win.time}</span>
                </div>
                {winItems.map((item) => (
                  <StackRow
                    key={item.id}
                    item={item}
                    isTaken={!!taken[item.id]}
                    isLow={low.includes(item.id)}
                    isMissed={!taken[item.id] && isPastCutoff}
                    accent={accent}
                    onToggle={() => toggleTaken(item.id)}
                    onLow={() => toggleLow(item.id)}
                    onDelete={() => deleteItem(item.id)}
                    onEdit={(patch) => updateItem(item.id, patch)}
                  />
                ))}
              </div>
            );
          })
        )}

        <AddForm onAdd={addItem} />
      </Card>
      <div className="pb-1 text-center font-mono text-[10px] uppercase tracking-[0.16em] text-ink-4">
        // editable template · all data stays in your browser
      </div>
    </div>
  );
}

function StackTicker({ issues, total }: { issues: { type: 'missed' | 'low'; text: string }[]; total: number }) {
  const [idx, setIdx] = React.useState(0);
  const [fading, setFading] = React.useState(false);

  React.useEffect(() => {
    setIdx(0);
    if (issues.length <= 1) return;
    const t = setInterval(() => {
      setFading(true);
      setTimeout(() => {
        setIdx((i) => (i + 1) % issues.length);
        setFading(false);
      }, 280);
    }, 5000);
    return () => clearInterval(t);
  }, [issues.length]);

  const hasMissed = issues.some((i) => i.type === 'missed');
  const msg = issues.length === 0 ? 'All caught up — keep it rolling' : issues[Math.min(idx, issues.length - 1)].text;
  const dotCls =
    issues.length === 0
      ? 'bg-good'
      : hasMissed
        ? 'bg-bad animate-pulse shadow-[0_0_0_4px_rgba(239,68,68,0.12)]'
        : 'bg-[#FF8A4D]';

  return (
    <div className="mb-4 flex min-h-9 items-center gap-3 rounded-[10px] border border-white/[0.04] bg-black/30 px-3.5 py-2.5 text-[12px]">
      <span className={`h-2 w-2 shrink-0 rounded-full transition-colors ${dotCls}`} aria-hidden />
      <span className="shrink-0 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-ink-3">STACK</span>
      <span className="shrink-0 text-ink-4">·</span>
      <span
        className={`min-w-0 flex-1 truncate text-[12px] font-semibold text-ink transition-opacity duration-300 ${fading ? 'opacity-0' : 'opacity-100'}`}
        aria-live="polite"
      >
        {msg}
      </span>
      <span className="shrink-0 font-mono text-[11px] tabular-nums text-ink-3">
        {issues.length}/{total}
      </span>
    </div>
  );
}

function StackRow({
  item,
  isTaken,
  isLow,
  isMissed,
  accent,
  onToggle,
  onLow,
  onDelete,
  onEdit,
}: {
  item: StackItem;
  isTaken: boolean;
  isLow: boolean;
  isMissed: boolean;
  accent: BentoAccent;
  onToggle: () => void;
  onLow: () => void;
  onDelete: () => void;
  onEdit: (patch: Partial<StackItem>) => void;
}) {
  const [editingName, setEditingName] = React.useState(false);
  const [editingMeta, setEditingMeta] = React.useState(false);
  const [nameDraft, setNameDraft] = React.useState(item.name);
  const metaText = [item.dose, item.note].filter(Boolean).join(' · ');
  const [metaDraft, setMetaDraft] = React.useState(metaText);

  React.useEffect(() => setNameDraft(item.name), [item.name]);
  React.useEffect(() => setMetaDraft(metaText), [metaText]);

  return (
    <div
      className={`mb-1.5 grid grid-cols-[32px_1fr_auto_auto] items-center gap-2.5 rounded-[10px] border px-3 py-2.5 transition-colors ${
        isMissed && !isTaken
          ? 'animate-pulse border-red-500/45 bg-white/[0.035]'
          : isTaken
            ? 'border-transparent bg-good/[0.08]'
            : 'border-transparent bg-white/[0.035] hover:bg-white/[0.05]'
      } max-sm:grid-cols-[28px_1fr_auto]`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-label={isTaken ? 'Mark not taken' : 'Mark taken'}
        aria-pressed={isTaken}
        className={`flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-full border-2 text-[13px] transition-all ${
          isTaken
            ? 'border-transparent text-white shadow-[0_0_12px_rgba(29,158,117,0.35)]'
            : 'border-white/[0.14] bg-white/[0.03] text-transparent hover:border-[#1D9E75]'
        }`}
        style={isTaken ? { background: '#1D9E75' } : undefined}
      >
        ✓
      </button>
      <div className="min-w-0">
        {editingName ? (
          <input
            autoFocus
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={() => {
              setEditingName(false);
              if (nameDraft.trim()) onEdit({ name: nameDraft.trim() });
              else setNameDraft(item.name);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') {
                setNameDraft(item.name);
                setEditingName(false);
              }
            }}
            className="w-full rounded border border-white/25 bg-black/30 px-1.5 py-0.5 text-[14px] font-semibold text-ink outline-none"
          />
        ) : (
          <div
            onClick={() => setEditingName(true)}
            className={`inline-flex cursor-text flex-wrap items-center gap-2 text-[14px] font-semibold leading-tight ${
              isTaken ? 'text-ink-3 line-through' : 'text-ink'
            }`}
          >
            {item.name}
            {item.tag === 'stack' && (
              <span className="rounded-full bg-[#D8AB30]/15 px-2 py-0.5 font-mono text-[10px] font-semibold lowercase tracking-[0.04em] text-[#D8AB30]">
                stack
              </span>
            )}
            {item.tag === 'not-ordered' && (
              <span className="rounded-full bg-red-900/10 px-2 py-0.5 font-mono text-[10px] font-semibold lowercase tracking-[0.04em] text-ink-3">
                not ordered
              </span>
            )}
          </div>
        )}
        {editingMeta ? (
          <input
            autoFocus
            value={metaDraft}
            onChange={(e) => setMetaDraft(e.target.value)}
            onBlur={() => {
              setEditingMeta(false);
              const parts = metaDraft.trim().split(/\s*·\s*/);
              onEdit({ dose: parts[0] || '', note: parts.slice(1).join(' · ') });
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') {
                setMetaDraft(metaText);
                setEditingMeta(false);
              }
            }}
            className="mt-0.5 w-full rounded border border-white/20 bg-black/30 px-1.5 py-0.5 text-[11px] text-ink-2 outline-none"
          />
        ) : (
          <div onClick={() => setEditingMeta(true)} className="mt-0.5 cursor-text text-[11px] text-ink-3">
            {metaText || <span className="italic text-ink-4">add notes…</span>}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={onLow}
        className={`inline-flex cursor-pointer items-center gap-1 whitespace-nowrap rounded-md border px-2 py-1 font-mono text-[10px] font-semibold tracking-[0.04em] transition-all max-sm:col-start-2 max-sm:mt-1 max-sm:justify-self-start ${
          isLow
            ? 'border-red-900/40 bg-red-900/10 text-[#FF8A4D]'
            : 'border-white/[0.14] text-ink-3 hover:border-red-900/40 hover:text-[#FF8A4D]'
        }`}
        aria-pressed={isLow}
      >
        ↓ Running low
      </button>
      <button
        type="button"
        onClick={onDelete}
        aria-label="Delete"
        className="flex h-7 min-w-7 cursor-pointer items-center justify-center rounded-md border border-white/[0.14] text-ink-3 opacity-70 transition-all hover:border-red-500/45 hover:bg-red-500/[0.08] hover:text-[#FF6B6B] hover:opacity-100 max-sm:col-start-3 max-sm:row-start-1"
      >
        <X size={14} aria-hidden />
      </button>
    </div>
  );
}

function AddForm({
  onAdd,
}: {
  onAdd: (name: string, dose: string, window: StackWindowKey, note: string) => void;
}) {
  const [name, setName] = React.useState('');
  const [dose, setDose] = React.useState('');
  const [win, setWin] = React.useState<StackWindowKey>('morning');
  const [note, setNote] = React.useState('');
  const [open, setOpen] = React.useState(false);
  const wrapRef = React.useRef<HTMLDivElement>(null);

  const results = React.useMemo(() => (open ? searchSupplements(name) : []), [name, open]);

  React.useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('click', onDoc);
    return () => document.removeEventListener('click', onDoc);
  }, []);

  const submit = () => {
    onAdd(name, dose, win, note);
    setName('');
    setDose('');
    setNote('');
    setOpen(false);
  };

  const pick = (s: (typeof results)[number]) => {
    setName(s.name);
    setDose(s.dose);
    setWin(s.window);
    setNote(s.note);
    setOpen(false);
  };

  return (
    <div className="mt-4 border-t border-white/[0.04] pt-3.5">
      <div className="mb-2.5 font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-3">
        Add to stack
      </div>
      <div className="grid grid-cols-[1fr_1fr_110px_90px] gap-1.5 max-sm:grid-cols-2">
        <div ref={wrapRef} className="relative min-w-0">
          <TextInput
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setNote('');
              setOpen(true);
            }}
            onFocus={() => name.trim() && setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                if (results.length) pick(results[0]);
                else submit();
              }
              if (e.key === 'Escape') setOpen(false);
            }}
            placeholder="Name (e.g. B-complex)"
            autoComplete="off"
            spellCheck={false}
            className="w-full text-[13px]"
          />
          {open && results.length > 0 && (
            <div className="absolute left-0 top-[calc(100%+6px)] z-40 max-h-[280px] w-[max(100%,320px)] overflow-y-auto rounded-xl border border-white/[0.14] bg-[#0f0f12]/95 p-1.5 shadow-[0_16px_40px_rgba(0,0,0,0.65)] backdrop-blur-xl">
              {results.map((s) => (
                <button
                  key={s.name}
                  type="button"
                  onClick={() => pick(s)}
                  className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-white/[0.06]"
                >
                  <span className="w-6 shrink-0 text-center text-[16px]" aria-hidden>
                    {s.icon}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-semibold leading-tight text-ink">{s.name}</span>
                    <span className="mt-0.5 block truncate text-[11px] text-ink-3">
                      {s.dose} · {s.window} · {s.note}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        <TextInput
          value={dose}
          onChange={(e) => setDose(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="Dose (e.g. 1 cap)"
          className="min-w-0 text-[13px]"
        />
        <SelectInput
          value={win}
          onChange={(e) => setWin(e.target.value as StackWindowKey)}
          className="text-[13px] max-sm:col-span-2"
        >
          <option value="morning">Morning</option>
          <option value="lunch">Lunch</option>
          <option value="evening">Evening</option>
          <option value="anytime">Anytime</option>
        </SelectInput>
        <PrimaryButton onClick={submit} className="max-sm:col-span-2">
          + Add
        </PrimaryButton>
      </div>
    </div>
  );
}
