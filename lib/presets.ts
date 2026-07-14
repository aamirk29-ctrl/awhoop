// Saved meal presets — a named, frozen list of food entries.
//
// A preset item is exactly a FoodEntry minus its identity (id/ts), so logging a
// preset just replays its items through addEntries with fresh timestamps. The
// resulting log rows are indistinguishable from having searched and logged each
// food by hand, which means totals, editing and deletion all keep working with
// no preset-specific handling anywhere downstream.

import { storeGet, storeSet } from './storage';
import { addEntries, type FoodEntry } from './food';

export const PRESETS_KEY = 'meal_presets_v1';

export type PresetItem = Omit<FoodEntry, 'id' | 'ts'>;

export type MealPreset = {
  id: string;
  name: string;
  items: PresetItem[];
  createdAt: number;
};

export function loadPresets(): MealPreset[] {
  const raw = storeGet<MealPreset[]>(PRESETS_KEY);
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((p) => p && typeof p.name === 'string' && Array.isArray(p.items))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function save(presets: MealPreset[]) {
  storeSet(PRESETS_KEY, presets);
}

export function createPreset(name: string, items: PresetItem[]): void {
  const clean = name.trim();
  if (!clean || items.length === 0) return;
  save([
    ...loadPresets(),
    {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: clean,
      items,
      createdAt: Date.now(),
    },
  ]);
}

export function renamePreset(id: string, name: string): void {
  const clean = name.trim();
  if (!clean) return;
  save(loadPresets().map((p) => (p.id === id ? { ...p, name: clean } : p)));
}

/** Replace a preset's contents. Deleting the last item removes the preset —
 *  an empty preset would log nothing and just clutter the chip row. */
export function updatePresetItems(id: string, items: PresetItem[]): void {
  if (items.length === 0) {
    deletePreset(id);
    return;
  }
  save(loadPresets().map((p) => (p.id === id ? { ...p, items } : p)));
}

export function deletePreset(id: string): void {
  save(loadPresets().filter((p) => p.id !== id));
}

export type PresetTotals = { kcal: number; protein: number; items: number };

export function presetTotals(p: MealPreset): PresetTotals {
  return p.items.reduce<PresetTotals>(
    (t, i) => ({
      kcal: t.kcal + (i.kcal || 0),
      protein: t.protein + (i.protein || 0),
      items: t.items + 1,
    }),
    { kcal: 0, protein: 0, items: 0 },
  );
}

/** Log every item in the preset, timestamped now. One storage write. */
export function logPreset(p: MealPreset): void {
  if (p.items.length === 0) return;
  addEntries(p.items);
}

/** Strip identity off log rows so they can be stored as preset contents. */
export function toPresetItems(entries: FoodEntry[]): PresetItem[] {
  /* eslint-disable @typescript-eslint/no-unused-vars */
  return entries.map(({ id, ts, ...rest }) => rest);
  /* eslint-enable @typescript-eslint/no-unused-vars */
}
