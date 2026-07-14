'use client';

// Saved meals — one-tap quick-add chips, plus a manage modal for rename/edit/delete.
// Chips sit above the search box because logging a known meal is the fast path.

import * as React from 'react';
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react';
import { motion } from 'motion/react';
import type { BentoAccent } from '@/components/ui/aurora-bento-grid';
import {
  createPreset,
  deletePreset,
  loadPresets,
  logPreset,
  presetTotals,
  renamePreset,
  toPresetItems,
  updatePresetItems,
  type MealPreset,
} from '@/lib/presets';
import { useStorageTick } from '@/lib/storage';
import type { FoodEntry } from '@/lib/food';
import { Card, EmptyState, Eyebrow, Modal, PrimaryButton, TextInput, confirmDialog } from './shared';

const r0 = (n: number) => Math.round(n);
const r1 = (n: number) => Math.round(n * 10) / 10;

export default function MealPresets({
  entries,
  accent,
}: {
  entries: FoodEntry[];
  accent: BentoAccent;
}) {
  const tick = useStorageTick();
  const presets = React.useMemo(() => loadPresets(), [tick]);
  const [manageOpen, setManageOpen] = React.useState(false);
  const [saveOpen, setSaveOpen] = React.useState(false);
  const [justLogged, setJustLogged] = React.useState<string | null>(null);

  const quickAdd = (p: MealPreset) => {
    logPreset(p);
    // Brief confirmation — the chip is the only thing that moved, so without it
    // a one-tap log gives no feedback beyond the numbers ticking up.
    setJustLogged(p.id);
    setTimeout(() => setJustLogged((v) => (v === p.id ? null : v)), 1200);
  };

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between gap-3">
        <Eyebrow>SAVED MEALS</Eyebrow>
        <div className="flex gap-1.5">
          {entries.length > 0 && (
            <button
              type="button"
              onClick={() => setSaveOpen(true)}
              className="cursor-pointer rounded-lg border border-white/[0.09] bg-white/[0.04] px-2.5 py-1.5 text-[11px] font-semibold text-ink-2 transition-colors hover:bg-white/[0.09] hover:text-ink"
            >
              Save from log
            </button>
          )}
          {presets.length > 0 && (
            <button
              type="button"
              onClick={() => setManageOpen(true)}
              className="cursor-pointer rounded-lg border border-white/[0.09] bg-white/[0.04] px-2.5 py-1.5 text-[11px] font-semibold text-ink-2 transition-colors hover:bg-white/[0.09] hover:text-ink"
            >
              Manage
            </button>
          )}
        </div>
      </div>

      {presets.length === 0 ? (
        <EmptyState>
          {entries.length > 0
            ? 'No saved meals yet — log some food, then “Save from log”.'
            : 'No saved meals yet. Log a meal, then save it for one-tap re-logging.'}
        </EmptyState>
      ) : (
        <div className="flex flex-wrap gap-2">
          {presets.map((p) => {
            const t = presetTotals(p);
            const logged = justLogged === p.id;
            return (
              <motion.button
                key={p.id}
                type="button"
                onClick={() => quickAdd(p)}
                whileTap={{ scale: 0.96 }}
                transition={{ duration: 0.15 }}
                aria-label={`Log ${p.name}: ${r0(t.kcal)} calories, ${r1(t.protein)} grams protein`}
                className="group flex min-h-[44px] cursor-pointer items-center gap-2.5 rounded-full border py-2 pl-3 pr-3.5 text-left transition-colors"
                style={{
                  borderColor: logged ? `${accent.from}88` : 'rgba(255,255,255,0.09)',
                  background: logged ? `${accent.from}1f` : 'rgba(255,255,255,0.035)',
                }}
              >
                <span
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition-colors"
                  style={{
                    background: logged ? accent.from : `${accent.from}26`,
                    color: logged ? '#0a0a0b' : accent.text,
                  }}
                  aria-hidden
                >
                  {logged ? <Check size={12} strokeWidth={3} /> : <Plus size={12} strokeWidth={3} />}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[12.5px] font-semibold leading-tight text-ink">
                    {logged ? 'Added' : p.name}
                  </span>
                  <span className="mt-0.5 block font-mono text-[10px] tabular-nums text-ink-3">
                    {r0(t.kcal)} kcal · {r1(t.protein)}g P
                  </span>
                </span>
              </motion.button>
            );
          })}
        </div>
      )}

      <SaveFromLogModal
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        entries={entries}
        accent={accent}
      />
      <ManageModal open={manageOpen} onClose={() => setManageOpen(false)} presets={presets} />
    </Card>
  );
}

// ---- save from today's log --------------------------------------------------

function SaveFromLogModal({
  open,
  onClose,
  entries,
  accent,
}: {
  open: boolean;
  onClose: () => void;
  entries: FoodEntry[];
  accent: BentoAccent;
}) {
  const [name, setName] = React.useState('');
  const [picked, setPicked] = React.useState<Set<string>>(new Set());

  // Default to everything selected — saving the whole meal is the common case.
  React.useEffect(() => {
    if (open) {
      setPicked(new Set(entries.map((e) => e.id)));
      setName('');
    }
  }, [open, entries]);

  const toggle = (id: string) =>
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const chosen = entries.filter((e) => picked.has(e.id));
  const kcal = chosen.reduce((s, e) => s + e.kcal, 0);
  const protein = chosen.reduce((s, e) => s + e.protein, 0);
  const valid = name.trim() !== '' && chosen.length > 0;

  const submit = () => {
    if (!valid) return;
    createPreset(name, toPresetItems(chosen));
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="Save as meal preset" maxWidth={460}>
      <label className="mb-3 flex flex-col gap-1.5">
        <span className="text-[10.5px] font-bold uppercase tracking-[0.06em] text-ink-3">
          Preset name
        </span>
        <TextInput
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="e.g. Post-workout shake"
          autoFocus
        />
      </label>

      <div className="mb-2 text-[10.5px] font-bold uppercase tracking-[0.06em] text-ink-3">
        Include ({chosen.length}/{entries.length})
      </div>
      <div className="mb-3 flex max-h-[220px] flex-col gap-1.5 overflow-y-auto">
        {entries.map((e) => {
          const on = picked.has(e.id);
          return (
            <button
              key={e.id}
              type="button"
              onClick={() => toggle(e.id)}
              aria-pressed={on}
              className={`flex min-h-[44px] cursor-pointer items-center gap-2.5 rounded-[10px] border px-3 py-2 text-left transition-colors ${
                on
                  ? 'border-white/[0.14] bg-white/[0.06]'
                  : 'border-white/[0.06] bg-white/[0.02] opacity-55 hover:opacity-80'
              }`}
            >
              <span
                className="flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors"
                style={{
                  borderColor: on ? accent.from : 'rgba(255,255,255,0.2)',
                  background: on ? accent.from : 'transparent',
                  color: '#0a0a0b',
                }}
                aria-hidden
              >
                {on && <Check size={11} strokeWidth={3.5} />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] font-semibold text-ink">{e.name}</span>
                <span className="block truncate font-mono text-[10px] text-ink-3">{e.servingLabel}</span>
              </span>
              <span className="shrink-0 font-mono text-[11px] tabular-nums text-ink-2">
                {r0(e.kcal)} · {r1(e.protein)}g
              </span>
            </button>
          );
        })}
      </div>

      <div className="mb-3 flex items-baseline justify-between rounded-[10px] border border-white/[0.07] bg-white/[0.025] px-3 py-2.5">
        <span className="text-[12px] font-semibold text-ink-2">Preset total</span>
        <span className="font-mono text-[13px] font-bold tabular-nums" style={{ color: accent.text }}>
          {r0(kcal)} kcal · {r1(protein)}g P
        </span>
      </div>

      <PrimaryButton onClick={submit} disabled={!valid} className="w-full">
        Save preset
      </PrimaryButton>
      {!valid && (
        <p className="mt-1.5 text-center text-[11px] italic text-ink-3">
          Name it and pick at least one item.
        </p>
      )}
    </Modal>
  );
}

// ---- manage -----------------------------------------------------------------

function ManageModal({
  open,
  onClose,
  presets,
}: {
  open: boolean;
  onClose: () => void;
  presets: MealPreset[];
}) {
  const [editingId, setEditingId] = React.useState<string | null>(null);

  return (
    <Modal open={open} onClose={onClose} title="Manage saved meals" maxWidth={480}>
      {presets.length === 0 ? (
        <EmptyState>No saved meals.</EmptyState>
      ) : (
        <div className="flex flex-col gap-2">
          {presets.map((p) =>
            editingId === p.id ? (
              <PresetEditor key={p.id} preset={p} onDone={() => setEditingId(null)} />
            ) : (
              <PresetRow key={p.id} preset={p} onEdit={() => setEditingId(p.id)} />
            ),
          )}
        </div>
      )}
      <PrimaryButton onClick={onClose} className="mt-4 w-full">
        Done
      </PrimaryButton>
    </Modal>
  );
}

function PresetRow({ preset, onEdit }: { preset: MealPreset; onEdit: () => void }) {
  const t = presetTotals(preset);
  return (
    <div className="flex items-center gap-2.5 rounded-[10px] border border-white/[0.07] bg-white/[0.025] px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-semibold text-ink">{preset.name}</div>
        <div className="mt-0.5 font-mono text-[10.5px] tabular-nums text-ink-3">
          {t.items} item{t.items === 1 ? '' : 's'} · {r0(t.kcal)} kcal · {r1(t.protein)}g P
        </div>
      </div>
      <button
        type="button"
        onClick={onEdit}
        aria-label={`Edit ${preset.name}`}
        className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-white/[0.07] bg-white/[0.03] text-ink-3 transition-colors hover:bg-white/[0.09] hover:text-ink"
      >
        <Pencil size={13} aria-hidden />
      </button>
      <button
        type="button"
        onClick={() => {
          if (confirmDialog(`Delete the “${preset.name}” preset? This can't be undone.`)) {
            deletePreset(preset.id);
          }
        }}
        aria-label={`Delete ${preset.name}`}
        className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-white/[0.07] bg-white/[0.03] text-ink-4 transition-colors hover:bg-bad/15 hover:text-bad"
      >
        <Trash2 size={13} aria-hidden />
      </button>
    </div>
  );
}

/** Rename + remove individual items. Removing the last item deletes the preset. */
function PresetEditor({ preset, onDone }: { preset: MealPreset; onDone: () => void }) {
  const [name, setName] = React.useState(preset.name);
  const [items, setItems] = React.useState(preset.items);

  const save = () => {
    if (name.trim() && name.trim() !== preset.name) renamePreset(preset.id, name);
    if (items.length !== preset.items.length) updatePresetItems(preset.id, items);
    onDone();
  };

  return (
    <div className="rounded-[10px] border border-white/[0.14] bg-white/[0.05] p-3">
      <div className="mb-2.5 flex gap-2">
        <TextInput
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && save()}
          className="min-w-0 flex-1"
          aria-label="Preset name"
        />
        <button
          type="button"
          onClick={save}
          aria-label="Save preset"
          className="flex h-[42px] w-[42px] shrink-0 cursor-pointer items-center justify-center rounded-lg border border-white/[0.09] bg-white/[0.06] text-ink transition-colors hover:bg-white/[0.12]"
        >
          <Check size={15} aria-hidden />
        </button>
        <button
          type="button"
          onClick={onDone}
          aria-label="Cancel"
          className="flex h-[42px] w-[42px] shrink-0 cursor-pointer items-center justify-center rounded-lg border border-white/[0.09] bg-white/[0.03] text-ink-3 transition-colors hover:bg-white/[0.09]"
        >
          <X size={15} aria-hidden />
        </button>
      </div>

      <div className="flex flex-col gap-1">
        {items.map((it, i) => (
          <div
            key={`${it.name}-${i}`}
            className="flex items-center gap-2 rounded-lg bg-black/20 px-2.5 py-1.5"
          >
            <span className="min-w-0 flex-1 truncate text-[12px] text-ink-2">{it.name}</span>
            <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-ink-3">
              {r0(it.kcal)} · {r1(it.protein)}g
            </span>
            <button
              type="button"
              onClick={() => setItems(items.filter((_, j) => j !== i))}
              aria-label={`Remove ${it.name} from preset`}
              className="shrink-0 cursor-pointer px-1 text-ink-4 transition-colors hover:text-bad"
            >
              <X size={13} aria-hidden />
            </button>
          </div>
        ))}
      </div>
      {items.length === 0 && (
        <p className="mt-1.5 text-[11px] italic text-warn">
          Removing every item deletes the preset.
        </p>
      )}
      <p className="mt-2 text-[10.5px] leading-snug text-ink-3">
        To add items, log them and use “Save from log” to make a new preset.
      </p>
    </div>
  );
}
