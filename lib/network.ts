// Networking / reachout tracker. Schema is an extension of the old
// personal_planner.html reachout dialog (name/role/company/notes carry over
// directly), not a verbatim port: that file had one "reachout date" field,
// which can't drive a staleness nudge. Here lastContactDate (the past) and
// nextFollowUpDate (the future) are tracked separately so "going cold" has
// something real to measure against.

import { rankByStaleness } from './staleness';
import { parseDateKey } from './dates';
import { storeGet, storeSet } from './storage';

export type Contact = {
  id: string;
  name: string;
  role: string;
  company: string;
  /** yyyy-mm-dd, or null if never logged */
  lastContactDate: string | null;
  /** yyyy-mm-dd, or null if nothing scheduled */
  nextFollowUpDate: string | null;
  notes: string;
};

const CONTACTS_KEY = 'network_contacts_v1';
const STALE_WEEKS_KEY = 'network_stale_weeks_v1';
const DEFAULT_STALE_WEEKS = 6;

export function loadContacts(): Contact[] {
  return storeGet<Contact[]>(CONTACTS_KEY) || [];
}

function save(list: Contact[]) {
  storeSet(CONTACTS_KEY, list);
}

export function addContact(data: Omit<Contact, 'id'>) {
  const list = loadContacts();
  list.push({ id: `c${Date.now()}${Math.random().toString(36).slice(2, 6)}`, ...data });
  save(list);
}

export function updateContact(id: string, patch: Partial<Omit<Contact, 'id'>>) {
  const list = loadContacts();
  const idx = list.findIndex((c) => c.id === id);
  if (idx === -1) return;
  list[idx] = { ...list[idx], ...patch };
  save(list);
}

export function deleteContact(id: string) {
  save(loadContacts().filter((c) => c.id !== id));
}

/** Scheduling a follow-up reminder records what was scheduled, not a past
 *  contact — only nextFollowUpDate moves. lastContactDate is untouched. */
export function scheduleFollowUp(id: string, date: string) {
  updateContact(id, { nextFollowUpDate: date });
}

export function loadStaleWeeks(): number {
  return storeGet<number>(STALE_WEEKS_KEY) ?? DEFAULT_STALE_WEEKS;
}

export function saveStaleWeeks(weeks: number) {
  storeSet(STALE_WEEKS_KEY, weeks);
}

function lastContactMs(c: Contact): number | null {
  if (!c.lastContactDate) return null;
  return parseDateKey(c.lastContactDate).getTime();
}

/** Contacts you haven't touched in `weeks` (or never touched at all),
 *  stalest — or never-contacted — first. Reuses the same generic ranker the
 *  Gym box and CFA tab already use; not a second implementation. */
export function staleContacts(contacts: Contact[], weeks: number): Contact[] {
  const cutoff = Date.now() - weeks * 7 * 86_400_000;
  const cold = contacts.filter((c) => {
    const at = lastContactMs(c);
    return at == null || at < cutoff;
  });
  return rankByStaleness(cold, lastContactMs);
}
