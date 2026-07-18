// CFA Level I study plan — topic tree and reading list ported verbatim (dates,
// minutes, ordering) from the old standalone personal_planner.html artifact.
// Only per-reading progress (completedAt / lastReviewedAt) is new: the old
// file never persisted anything, so there was no real data to migrate, just
// the tree itself.

import { rankByStaleness } from './staleness';
import { dateToKey, parseDateKey } from './dates';
import { storeGet, storeSet } from './storage';

export type CfaTopic = {
  id: string;
  name: string;
  /** accent hex — tint/opacity applied at render time for the dark theme */
  color: string;
  /** unused for now; lets progress switch to exam-weighted later without
   *  re-entering the tree */
  weight?: number;
};

export type CfaReading = {
  id: string;
  topicId: string;
  num: number;
  name: string;
  dueDate: string;
  minutes: number;
};

export type CfaProgressEntry = { completedAt: number | null; lastReviewedAt: number | null };
export type CfaProgress = Record<string, CfaProgressEntry>;

export type StudySlot = 'weekday-evening' | 'weekend-morning' | 'weekend-afternoon' | 'weekend-evening';
export type StudySlotConfig = Record<StudySlot, boolean>;

export const EXAM_DATE = '2026-08-24';

export const CFA_TOPICS: CfaTopic[] = [
  { id: 'QM', name: 'Quant Methods', color: '#8B85E0' },
  { id: 'EC', name: 'Economics', color: '#5B9BD9' },
  { id: 'CI', name: 'Corporate Issuers', color: '#3FBF8F' },
  { id: 'FSA', name: 'Fin. Stmt Analysis', color: '#D9A63F' },
  { id: 'EQ', name: 'Equity', color: '#E08B5B' },
  { id: 'FI', name: 'Fixed Income', color: '#D9639A' },
  { id: 'DV', name: 'Derivatives', color: '#9B85E0' },
  { id: 'AI', name: 'Alt Investments', color: '#3FBFBF' },
  { id: 'PM', name: 'Portfolio Mgmt', color: '#7FAF4F' },
  { id: 'ETH', name: 'Ethics', color: '#D96B63' },
];

const RAW_READINGS: [string, number, string, string, number][] = [
  ['QM', 1, 'Rates and Returns', '2026-06-20', 63], ['QM', 2, 'Time Value of Money in Finance', '2026-06-21', 36],
  ['QM', 3, 'Statistical Measures of Asset Returns', '2026-06-21', 53], ['QM', 4, 'Probability Trees & Conditional Expectations', '2026-06-21', 30],
  ['QM', 5, 'Portfolio Mathematics', '2026-06-22', 34], ['QM', 6, 'Simulation Methods', '2026-06-22', 26],
  ['QM', 7, 'Estimation and Inference', '2026-06-22', 36], ['QM', 8, 'Hypothesis Testing', '2026-06-23', 32],
  ['QM', 9, 'Parametric & Non-Parametric Tests of Independence', '2026-06-23', 22], ['QM', 10, 'Simple Linear Regression', '2026-06-24', 81],
  ['QM', 11, 'Introduction to Big Data Techniques', '2026-06-24', 26],
  ['EC', 1, 'The Firm and Market Structures', '2026-06-25', 75], ['EC', 2, 'Understanding Business Cycles', '2026-06-25', 39],
  ['EC', 3, 'Fiscal Policy', '2026-06-26', 45], ['EC', 4, 'Monetary Policy', '2026-06-26', 67],
  ['EC', 5, 'Introduction to Geopolitics', '2026-06-27', 90], ['EC', 6, 'International Trade', '2026-06-28', 31],
  ['EC', 7, 'Capital Flows and the FX Market', '2026-06-28', 79], ['EC', 8, 'Exchange Rate Calculations', '2026-06-29', 28],
  ['CI', 1, 'Organizational Forms, Features & Ownership', '2026-06-29', 40], ['CI', 2, 'Investors and Other Stakeholders', '2026-06-29', 34],
  ['CI', 3, 'Corporate Governance', '2026-06-30', 38], ['CI', 4, 'Working Capital and Liquidity', '2026-06-30', 43],
  ['CI', 5, 'Capital Investments & Allocation', '2026-07-01', 46], ['CI', 6, 'Capital Structure', '2026-07-01', 51],
  ['CI', 7, 'Business Models', '2026-07-02', 43],
  ['FSA', 1, 'Introduction to FSA', '2026-07-02', 62], ['FSA', 2, 'Analyzing Income Statements', '2026-07-03', 79],
  ['FSA', 3, 'Analyzing Balance Sheets', '2026-07-04', 47], ['FSA', 4, 'Analyzing Cash Flows I', '2026-07-04', 36],
  ['FSA', 5, 'Analyzing Cash Flows II', '2026-07-04', 22], ['FSA', 6, 'Analysis of Inventories', '2026-07-04', 25],
  ['FSA', 7, 'Analysis of Long-Term Assets', '2026-07-05', 39], ['FSA', 8, 'Long-Term Liabilities and Equity', '2026-07-05', 56],
  ['FSA', 9, 'Analysis of Income Taxes', '2026-07-06', 39], ['FSA', 10, 'Financial Reporting Quality', '2026-07-07', 123],
  ['FSA', 11, 'Financial Analysis Techniques', '2026-07-08', 101], ['FSA', 12, 'Intro to Financial Statement Modeling', '2026-07-09', 79],
  ['EQ', 1, 'Market Organization and Structure', '2026-07-10', 134], ['EQ', 2, 'Security Market Indexes', '2026-07-11', 54],
  ['EQ', 3, 'Market Efficiency', '2026-07-11', 53], ['EQ', 4, 'Overview of Equity Securities', '2026-07-12', 65],
  ['EQ', 5, 'Company Analysis: Past and Present', '2026-07-13', 59], ['EQ', 6, 'Industry and Competitive Analysis', '2026-07-13', 55],
  ['EQ', 7, 'Company Analysis: Forecasting', '2026-07-14', 66], ['EQ', 8, 'Equity Valuation: Concepts & Tools', '2026-07-15', 75],
  ['FI', 1, 'Fixed-Income Instrument Features', '2026-07-15', 24], ['FI', 2, 'Fixed-Income Cash Flows and Types', '2026-07-15', 45],
  ['FI', 3, 'Fixed-Income Issuance and Trading', '2026-07-16', 27], ['FI', 4, 'FI Markets for Corporate Issuers', '2026-07-16', 36],
  ['FI', 5, 'FI Markets for Government Issuers', '2026-07-16', 28], ['FI', 6, 'Bond Valuation: Prices and Yields', '2026-07-17', 37],
  ['FI', 7, 'Yield & Spread Measures (Fixed-Rate)', '2026-07-17', 43], ['FI', 8, 'Yield & Spread Measures (Floating-Rate)', '2026-07-18', 33],
  ['FI', 9, 'Term Structure: Spot, Par, Forward', '2026-07-18', 27], ['FI', 10, 'Interest Rate Risk and Return', '2026-07-18', 29],
  ['FI', 11, 'Yield-Based Bond Duration', '2026-07-18', 35], ['FI', 12, 'Yield-Based Bond Convexity', '2026-07-19', 26],
  ['FI', 13, 'Curve-Based & Empirical Risk Measures', '2026-07-19', 34], ['FI', 14, 'Credit Risk', '2026-07-20', 51],
  ['FI', 15, 'Credit Analysis for Government Issuers', '2026-07-20', 37], ['FI', 16, 'Credit Analysis for Corporate Issuers', '2026-07-20', 38],
  ['FI', 17, 'Fixed-Income Securitization', '2026-07-21', 23], ['FI', 18, 'Asset-Backed Securities (ABS)', '2026-07-21', 42],
  ['FI', 19, 'Mortgage-Backed Securities (MBS)', '2026-07-22', 48],
  ['DV', 1, 'Derivative Instrument & Market Features', '2026-07-22', 21], ['DV', 2, 'Forward Commitment & Contingent Claim', '2026-07-22', 40],
  ['DV', 3, 'Derivative Benefits, Risks & Uses', '2026-07-22', 31], ['DV', 4, 'Arbitrage, Replication & Cost of Carry', '2026-07-23', 35],
  ['DV', 5, 'Pricing & Valuation of Forwards', '2026-07-23', 39], ['DV', 6, 'Pricing & Valuation of Futures', '2026-07-23', 26],
  ['DV', 7, 'Pricing & Valuation of Swaps', '2026-07-24', 25], ['DV', 8, 'Pricing & Valuation of Options', '2026-07-24', 31],
  ['DV', 9, 'Option Replication (Put–Call Parity)', '2026-07-24', 26], ['DV', 10, 'One-Period Binomial Model', '2026-07-25', 22],
  ['AI', 1, 'Alt Investment Features & Structures', '2026-07-25', 35], ['AI', 2, 'Alt Investment Performance & Returns', '2026-07-25', 36],
  ['AI', 3, 'Private Capital: Equity and Debt', '2026-07-26', 43], ['AI', 4, 'Real Estate and Infrastructure', '2026-07-26', 40],
  ['AI', 5, 'Natural Resources', '2026-07-26', 37], ['AI', 6, 'Hedge Funds', '2026-07-27', 49],
  ['AI', 7, 'Introduction to Digital Assets', '2026-07-28', 49],
  ['PM', 1, 'Portfolio Risk and Return: Part I', '2026-07-28', 86], ['PM', 2, 'Portfolio Risk and Return: Part II', '2026-07-29', 93],
  ['PM', 3, 'Portfolio Management: An Overview', '2026-07-30', 60], ['PM', 4, 'Basics of Portfolio Planning', '2026-07-31', 71],
  ['PM', 5, 'Behavioral Biases of Individuals', '2026-07-31', 58], ['PM', 6, 'Introduction to Risk Management', '2026-08-01', 115],
  ['ETH', 1, 'Ethics and Trust in Investment', '2026-08-02', 52], ['ETH', 2, 'Code of Ethics & Standards', '2026-08-02', 34],
  ['ETH', 3, 'Guidance for Standards I–VII', '2026-08-06', 401], ['ETH', 4, 'Intro to GIPS', '2026-08-07', 12],
  ['ETH', 5, 'Ethics Application', '2026-08-07', 91],
];

export const CFA_READINGS: CfaReading[] = RAW_READINGS.map(([topicId, num, name, dueDate, minutes]) => ({
  id: `${topicId}-${num}`,
  topicId,
  num,
  name,
  dueDate,
  minutes,
}));

export function readingsForTopic(topicId: string): CfaReading[] {
  return CFA_READINGS.filter((r) => r.topicId === topicId);
}

// ---- progress persistence ---------------------------------------------------

const PROGRESS_KEY = 'cfa_progress_v1';
const SLOTS_KEY = 'cfa_study_slots_v1';
const TOPIC_NOTES_KEY = 'cfa_topic_notes_v1';

// ---- per-topic weakness notes -----------------------------------------------

/** confidence: 1 (weak) – 5 (strong) self-rating, plus free-text detail the
 *  slider alone can't capture ("duration/convexity still shaky, redo M11"). */
export type CfaTopicNote = { confidence: number; notes: string };
export type CfaTopicNotes = Record<string, CfaTopicNote>;

const DEFAULT_TOPIC_NOTE: CfaTopicNote = { confidence: 3, notes: '' };

export function loadTopicNotes(): CfaTopicNotes {
  return storeGet<CfaTopicNotes>(TOPIC_NOTES_KEY) || {};
}

export function getTopicNote(topicId: string): CfaTopicNote {
  return loadTopicNotes()[topicId] || DEFAULT_TOPIC_NOTE;
}

export function saveTopicNote(topicId: string, patch: Partial<CfaTopicNote>) {
  const map = loadTopicNotes();
  const cur = map[topicId] || DEFAULT_TOPIC_NOTE;
  storeSet(TOPIC_NOTES_KEY, { ...map, [topicId]: { ...cur, ...patch } });
}

export function loadCfaProgress(): CfaProgress {
  return storeGet<CfaProgress>(PROGRESS_KEY) || {};
}

function entryFor(progress: CfaProgress, readingId: string): CfaProgressEntry {
  return progress[readingId] || { completedAt: null, lastReviewedAt: null };
}

export function isDone(progress: CfaProgress, readingId: string): boolean {
  return entryFor(progress, readingId).completedAt != null;
}

export function toggleReadingDone(readingId: string) {
  const progress = loadCfaProgress();
  const cur = entryFor(progress, readingId);
  const next: CfaProgress = {
    ...progress,
    [readingId]: { ...cur, completedAt: cur.completedAt == null ? Date.now() : null },
  };
  storeSet(PROGRESS_KEY, next);
}

/** Marks every reading in a topic as reviewed now — called when a review
 *  block is scheduled and confirmed (§3 of the plan). */
export function markTopicReviewed(topicId: string) {
  const progress = loadCfaProgress();
  const now = Date.now();
  const next: CfaProgress = { ...progress };
  for (const r of readingsForTopic(topicId)) {
    next[r.id] = { ...entryFor(progress, r.id), lastReviewedAt: now };
  }
  storeSet(PROGRESS_KEY, next);
}

export function pctComplete(progress: CfaProgress): number {
  const total = CFA_READINGS.length;
  if (total === 0) return 0;
  const done = CFA_READINGS.filter((r) => isDone(progress, r.id)).length;
  return Math.round((done / total) * 100);
}

export function doneCount(progress: CfaProgress): number {
  return CFA_READINGS.filter((r) => isDone(progress, r.id)).length;
}

// ---- staleness — most-neglected topics first --------------------------------

/** A topic's staleness timestamp = the most recent lastReviewedAt across its
 *  readings, or null if none have ever been reviewed (most urgent). */
function topicLastReviewedAt(progress: CfaProgress, topicId: string): number | null {
  const readings = readingsForTopic(topicId);
  let latest: number | null = null;
  for (const r of readings) {
    const at = entryFor(progress, r.id).lastReviewedAt;
    if (at != null && (latest == null || at > latest)) latest = at;
  }
  return latest;
}

/** Most-neglected topics first, via the same generic ranker the Gym box's
 *  exercise recommender uses (lib/staleness.ts) — not reimplemented here. */
export function mostStaleTopics(progress: CfaProgress, n: number): CfaTopic[] {
  return rankByStaleness(CFA_TOPICS, (t) => topicLastReviewedAt(progress, t.id)).slice(0, n);
}

// ---- countdown + study capacity ---------------------------------------------

export function daysUntilExam(): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const exam = parseDateKey(EXAM_DATE);
  return Math.max(0, Math.round((exam.getTime() - today.getTime()) / 86_400_000));
}

export const STUDY_SLOTS: { id: StudySlot; label: string }[] = [
  { id: 'weekday-evening', label: 'Weekday evenings' },
  { id: 'weekend-morning', label: 'Weekend mornings' },
  { id: 'weekend-afternoon', label: 'Weekend afternoons' },
  { id: 'weekend-evening', label: 'Weekend evenings' },
];

const DEFAULT_SLOTS: StudySlotConfig = {
  'weekday-evening': true,
  'weekend-morning': true,
  'weekend-afternoon': true,
  'weekend-evening': true,
};

export function loadStudySlots(): StudySlotConfig {
  return { ...DEFAULT_SLOTS, ...(storeGet<Partial<StudySlotConfig>>(SLOTS_KEY) || {}) };
}

export function saveStudySlots(cfg: StudySlotConfig) {
  storeSet(SLOTS_KEY, cfg);
}

/** Raw days-remaining overstates real capacity (9:30am–6pm weekdays are work,
 *  not study). Counts one session per enabled slot per qualifying day between
 *  today and the exam, inclusive of today. */
export function sessionsRemaining(cfg: StudySlotConfig): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const exam = parseDateKey(EXAM_DATE);
  let sessions = 0;
  for (let d = new Date(today); d.getTime() <= exam.getTime(); d.setDate(d.getDate() + 1)) {
    const isWeekend = d.getDay() === 0 || d.getDay() === 6;
    if (isWeekend) {
      if (cfg['weekend-morning']) sessions++;
      if (cfg['weekend-afternoon']) sessions++;
      if (cfg['weekend-evening']) sessions++;
    } else if (cfg['weekday-evening']) {
      sessions++;
    }
  }
  return sessions;
}

export function dateKeyToday(): string {
  return dateToKey(new Date());
}
