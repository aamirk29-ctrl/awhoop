'use client';

// USDA FoodData Central client. Talks to /api/usda (which holds the key).
//
// FDC reports nutrients per 100 g for Foundation/SR Legacy/Branded alike, so we
// normalize everything to a per-100g basis and scale by the chosen portion's
// gram weight. That's what makes "1 cup" / "1 serving" / oz all work off one
// number instead of special-casing each unit.

/* eslint-disable @typescript-eslint/no-explicit-any */

/** FDC nutrient IDs. */
const N_KCAL = 1008;
const N_PROTEIN = 1003;
const N_FAT = 1004;
const N_CARBS = 1005;
/** Some records report energy in kJ (2047/2048) instead of kcal. */
const N_KCAL_ATWATER = 2047;
const N_KJ = 1062;

export const GRAMS_PER_OZ = 28.349523125;

export type Macros = { kcal: number; protein: number; carbs: number; fat: number };

export type Portion = {
  label: string;
  grams: number;
};

export type UsdaFood = {
  fdcId: number;
  name: string;
  brand?: string;
  dataType?: string;
  /** Nutrients per 100 g. */
  per100g: Macros;
  /** True when USDA published no energy field and kcal was reconstructed from
   *  macros via Atwater factors (common for Foundation foods). */
  kcalDerived: boolean;
  /** Selectable serving sizes, always including grams and oz. */
  portions: Portion[];
};

export class UsdaNotConfigured extends Error {}

async function call(qs: string): Promise<any> {
  const r = await fetch(`/api/usda?${qs}`);
  if (r.status === 503) {
    const j = await r.json().catch(() => ({}));
    throw new UsdaNotConfigured(j.error || 'USDA search is not configured.');
  }
  if (!r.ok) throw new Error(`USDA ${r.status}: ${await r.text()}`);
  return r.json();
}

function nutrientMap(food: any): Map<number, { value: number; unit: string }> {
  const m = new Map<number, { value: number; unit: string }>();
  const list: any[] = food?.foodNutrients || [];
  for (const n of list) {
    // Search results and detail records nest the id differently.
    const id = n?.nutrientId ?? n?.nutrient?.id;
    const value = n?.value ?? n?.amount;
    const unit = String(n?.unitName ?? n?.nutrient?.unitName ?? '').toLowerCase();
    if (typeof id === 'number' && typeof value === 'number') m.set(id, { value, unit });
  }
  return m;
}

/** Atwater general factors — kcal per gram of protein / carb / fat. */
const KCAL_PER_G_PROTEIN = 4;
const KCAL_PER_G_CARB = 4;
const KCAL_PER_G_FAT = 9;

function per100gFrom(food: any): { macros: Macros; kcalDerived: boolean } {
  const m = nutrientMap(food);
  // Carbs are computed "by difference" and can come back very slightly negative.
  const get = (id: number) => Math.max(0, m.get(id)?.value ?? 0);

  const protein = get(N_PROTEIN);
  const carbs = get(N_CARBS);
  const fat = get(N_FAT);

  let kcal = get(N_KCAL) || get(N_KCAL_ATWATER);
  if (!kcal) {
    const kj = m.get(N_KJ);
    if (kj) kcal = Math.max(0, kj.value) / 4.184;
  }

  // Foundation records publish measured analytes but NO energy field of any
  // kind — not kcal, not Atwater, not kJ. Left alone they'd log as 0 calories,
  // so reconstruct energy from the macros instead.
  let kcalDerived = false;
  if (!kcal && (protein > 0 || carbs > 0 || fat > 0)) {
    kcal = protein * KCAL_PER_G_PROTEIN + carbs * KCAL_PER_G_CARB + fat * KCAL_PER_G_FAT;
    kcalDerived = true;
  }

  return { macros: { kcal, protein, carbs, fat }, kcalDerived };
}

function portionsFrom(food: any): Portion[] {
  const out: Portion[] = [
    { label: '100 g', grams: 100 },
    { label: '1 oz', grams: GRAMS_PER_OZ },
  ];

  // Foundation / SR Legacy carry measured household portions.
  for (const p of food?.foodPortions || []) {
    const grams = p?.gramWeight;
    if (typeof grams !== 'number' || grams <= 0) continue;
    const amount = p?.amount ?? 1;
    const unit = p?.measureUnit?.name && p.measureUnit.name !== 'undetermined' ? p.measureUnit.name : '';
    const modifier = p?.modifier || '';
    const label = [amount, unit, modifier].filter(Boolean).join(' ').trim() || `${Math.round(grams)} g portion`;
    out.push({ label, grams });
  }

  // Branded foods carry a single label serving.
  const ss = food?.servingSize;
  const unit = String(food?.servingSizeUnit || '').toLowerCase();
  if (typeof ss === 'number' && ss > 0 && (unit === 'g' || unit === 'ml')) {
    // ml ≈ g is a real approximation, but it's the one the label itself implies.
    const household = food?.householdServingFullText;
    out.push({
      label: household ? `1 serving (${household})` : `1 serving (${ss}${unit})`,
      grams: ss,
    });
  }

  // De-dupe by gram weight, keep first (most descriptive) label.
  const seen = new Set<number>();
  return out.filter((p) => {
    const k = Math.round(p.grams * 100);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function normalize(food: any): UsdaFood {
  const { macros, kcalDerived } = per100gFrom(food);
  return {
    fdcId: food.fdcId,
    name: String(food.description || 'Unknown food'),
    brand: food.brandName || food.brandOwner || undefined,
    dataType: food.dataType,
    per100g: macros,
    kcalDerived,
    portions: portionsFrom(food),
  };
}

// FDC's default relevance ranking puts Branded first, which buries the
// authoritative entries: searching "chicken breast" returns a wall of generic
// supermarket labels disagreeing with each other (165/143/107/96 kcal) while the
// lab-measured SR Legacy record never surfaces. Foundation and SR Legacy are
// USDA's own analyses, so they lead.
const DATA_TYPE_RANK: Record<string, number> = {
  Foundation: 0,
  'SR Legacy': 1,
  'Survey (FNDDS)': 2,
  Branded: 3,
};

function rank(f: UsdaFood): number {
  return DATA_TYPE_RANK[f.dataType ?? ''] ?? 9;
}

export async function searchFoods(query: string): Promise<UsdaFood[]> {
  const data = await call(`q=${encodeURIComponent(query)}`);
  const foods: any[] = data?.foods || [];
  return foods
    .map(normalize)
    // Some Foundation records publish only sub-analytes (individual fatty acids,
    // vitamins) with no energy OR macros at all — nothing loggable, so drop them.
    .filter((f) => f.per100g.kcal > 0)
    .sort((a, b) => rank(a) - rank(b)); // stable: relevance order preserved within a tier
}

/** Full detail — search results omit foodPortions, so we refetch on select. */
export async function getFood(fdcId: number): Promise<UsdaFood> {
  return normalize(await call(`fdcId=${fdcId}`));
}

/** Scale per-100g nutrients to an arbitrary gram weight. */
export function macrosForGrams(per100g: Macros, grams: number): Macros {
  const f = grams / 100;
  return {
    kcal: per100g.kcal * f,
    protein: per100g.protein * f,
    carbs: per100g.carbs * f,
    fat: per100g.fat * f,
  };
}

/* eslint-enable @typescript-eslint/no-explicit-any */
