// Water target model — same math and localStorage shape (`po_water_v1`)
// as the old po-water.html, so history and settings carry over.

import { storeGet } from './storage';

export type WaterSubstance = {
  id: string;
  name: string;
  cat: string;
  unit: string;
  defaultDose: number;
  mlPerUnit: number;
  note?: string;
  dose?: number;
};

export type WaterProfile = {
  weightKg: number;
  age: number;
  sex: 'm' | 'f' | 'o';
  activityHrsPerWeek: number;
};

export type WaterState = {
  unit: 'bottle' | 'glass' | 'oz' | 'ml';
  bottleMl: number;
  glassMl: number;
  weightUnit: 'kg' | 'lb';
  profile: WaterProfile;
  caffeineMgPerDay: number;
  substances: WaterSubstance[];
  logs: Record<string, number>;
};

export const WATER_KEY = 'po_water_v1';

export function defaultWaterState(): WaterState {
  return {
    unit: 'bottle',
    bottleMl: 500,
    glassMl: 250,
    weightUnit: 'kg',
    profile: { weightKg: 75, age: 25, sex: 'm', activityHrsPerWeek: 5 },
    caffeineMgPerDay: 200,
    substances: [],
    logs: {},
  };
}

export function normalizeWaterState(s: Partial<WaterState> | null | undefined): WaterState {
  const d = defaultWaterState();
  const x = (s || {}) as Partial<WaterState>;
  return {
    unit: x.unit || d.unit,
    bottleMl: x.bottleMl || d.bottleMl,
    glassMl: x.glassMl || d.glassMl,
    weightUnit: x.weightUnit || d.weightUnit,
    profile: { ...d.profile, ...(x.profile || {}) },
    caffeineMgPerDay: x.caffeineMgPerDay != null ? x.caffeineMgPerDay : d.caffeineMgPerDay,
    substances: Array.isArray(x.substances) ? x.substances : [],
    logs: x.logs && typeof x.logs === 'object' ? x.logs : {},
  };
}

export function loadWaterState(): WaterState {
  return normalizeWaterState(storeGet<WaterState>(WATER_KEY));
}

export function subExtraMl(s: WaterSubstance): number {
  const dose = (s.dose != null ? s.dose : s.defaultDose) || 0;
  return Math.max(0, dose * (s.mlPerUnit || 0));
}

export function subDoseLabel(s: WaterSubstance): string {
  const dose = s.dose != null ? s.dose : s.defaultDose;
  return `${dose} ${s.unit || ''}`;
}

export type WaterCalc = {
  base: number;
  exercise: number;
  caffeine: number;
  subs: number;
  adjust: number;
  total: number;
};

// base = kg × 35ml (NAM/IOM) · exercise ≈ 500ml/hr · caffeine over 200mg
// adds 1.5ml/mg · substances add dose × mlPerUnit · +200ml male, +100ml 50+.
export function computeTargetMl(state: WaterState): WaterCalc {
  const p = state.profile;
  const wKg = state.weightUnit === 'lb' ? p.weightKg / 2.20462 : p.weightKg;
  const base = wKg * 35;
  const exercise = ((p.activityHrsPerWeek || 0) / 7) * 500;
  const caffeine = Math.max(0, (state.caffeineMgPerDay || 0) - 200) * 1.5;
  const subs = (state.substances || []).reduce((s, x) => s + subExtraMl(x), 0);
  let adjust = 0;
  if (p.sex === 'm') adjust += 200;
  if ((p.age || 0) >= 50) adjust += 100;
  return { base, exercise, caffeine, subs, adjust, total: base + exercise + caffeine + subs + adjust };
}

export function unitVolMl(state: WaterState): number {
  if (state.unit === 'bottle') return state.bottleMl || 500;
  if (state.unit === 'glass') return state.glassMl || 250;
  if (state.unit === 'oz') return 30;
  return 1;
}

export function unitLabelPlural(state: WaterState): string {
  if (state.unit === 'bottle') return 'bottles';
  if (state.unit === 'glass') return 'glasses';
  return state.unit;
}

export function unitLabelSingular(state: WaterState): string {
  if (state.unit === 'bottle') return 'bottle';
  if (state.unit === 'glass') return 'glass';
  return state.unit;
}

export function targetUnits(state: WaterState): number {
  return Math.max(1, Math.ceil(computeTargetMl(state).total / unitVolMl(state)));
}

export function fmtMl(ml: number): string {
  if (ml >= 1000) return `${(ml / 1000).toFixed(1)} L`;
  return `${Math.round(ml)} ml`;
}

// Substance database — conservative daily water bumps that scale with dose.
export const SUBSTANCE_DB: WaterSubstance[] = [
  { id: 'adderall', name: 'Adderall (mixed amphetamine salts)', cat: 'ADHD stim', unit: 'mg', defaultDose: 20, mlPerUnit: 25, note: 'Stim · reduces thirst signal · dries you out' },
  { id: 'concerta', name: 'Concerta (methylphenidate ER)', cat: 'ADHD stim', unit: 'mg', defaultDose: 36, mlPerUnit: 13.9, note: 'Stim · reduces thirst signal' },
  { id: 'vyvanse', name: 'Vyvanse (lisdexamfetamine)', cat: 'ADHD stim', unit: 'mg', defaultDose: 50, mlPerUnit: 10, note: 'Stim prodrug · long acting' },
  { id: 'ritalin', name: 'Ritalin IR (methylphenidate)', cat: 'ADHD stim', unit: 'mg', defaultDose: 20, mlPerUnit: 20, note: 'Short-acting stim' },
  { id: 'focalin', name: 'Focalin / Focalin XR', cat: 'ADHD stim', unit: 'mg', defaultDose: 20, mlPerUnit: 20, note: 'Methylphenidate isomer' },
  { id: 'modafinil', name: 'Modafinil', cat: 'Wakefulness', unit: 'mg', defaultDose: 200, mlPerUnit: 1.75, note: 'Mild dehydrating effect' },
  { id: 'lithium', name: 'Lithium', cat: 'Mood', unit: 'mg', defaultDose: 600, mlPerUnit: 1.67, note: 'Critical — narrow therapeutic window, dehydration → toxicity' },
  { id: 'hctz', name: 'Hydrochlorothiazide (HCTZ)', cat: 'Diuretic', unit: 'mg', defaultDose: 25, mlPerUnit: 40, note: 'Direct diuretic — drink to compensate' },
  { id: 'lasix', name: 'Furosemide (Lasix)', cat: 'Diuretic', unit: 'mg', defaultDose: 40, mlPerUnit: 30, note: 'Loop diuretic · talk to your doctor about target' },
  { id: 'spironol', name: 'Spironolactone', cat: 'Diuretic', unit: 'mg', defaultDose: 50, mlPerUnit: 12, note: 'K-sparing diuretic' },
  { id: 'sudafed', name: 'Pseudoephedrine (Sudafed)', cat: 'Decongestant', unit: 'mg', defaultDose: 60, mlPerUnit: 4.17, note: 'Sympathomimetic · dries mucous membranes' },
  { id: 'phenyl', name: 'Phenylephrine', cat: 'Decongestant', unit: 'mg', defaultDose: 10, mlPerUnit: 20, note: 'Vasoconstrictor — mild' },
  { id: 'nicotine', name: 'Nicotine pouch (Velo / Zyn)', cat: 'Stim', unit: 'pouches/day', defaultDose: 4, mlPerUnit: 62.5, note: 'Vasoconstriction + dry mouth' },
  { id: 'nicpatch', name: 'Nicotine patch', cat: 'Stim', unit: 'mg', defaultDose: 14, mlPerUnit: 18, note: '24-h transdermal · sustained release' },
  { id: 'alcohol', name: 'Alcohol', cat: 'Depressant', unit: 'drinks/day', defaultDose: 1, mlPerUnit: 400, note: '~10ml urine per gram ethanol — adds up fast' },
  { id: 'cannabis', name: 'Cannabis / THC', cat: 'Other', unit: 'sessions/day', defaultDose: 1, mlPerUnit: 250, note: 'Cottonmouth — saliva gland inhibition' },
  { id: 'creatine', name: 'Creatine monohydrate', cat: 'Supplement', unit: 'g/day', defaultDose: 5, mlPerUnit: 80, note: 'Pulls water into muscle cells — drink more' },
  { id: 'preworkout', name: 'Pre-workout (caffeine + others)', cat: 'Stim', unit: 'servings/day', defaultDose: 1, mlPerUnit: 300, note: 'High-stim formula on top of caffeine' },
  { id: 'metformin', name: 'Metformin', cat: 'Glucose', unit: 'mg', defaultDose: 1000, mlPerUnit: 0.3, note: 'Mild GI fluid loss' },
  { id: 'sertraline', name: 'SSRI (sertraline / escitalopram / fluoxetine)', cat: 'SSRI', unit: 'mg', defaultDose: 50, mlPerUnit: 4, note: 'Mild dry mouth in some users' },
  { id: 'wellbutrin', name: 'Bupropion (Wellbutrin)', cat: 'NDRI', unit: 'mg', defaultDose: 300, mlPerUnit: 1.17, note: 'Stim-like profile' },
];
