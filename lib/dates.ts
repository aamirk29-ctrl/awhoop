// Date helpers shared across panels. The "active date" rolls over at 6 AM so
// a late night still counts as the previous day — same rule the old pages used.

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function dateToKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function activeDateKey(): string {
  const now = new Date();
  if (now.getHours() < 6) {
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    return dateToKey(d);
  }
  return dateToKey(now);
}

export function tomorrowDateKey(): string {
  const now = new Date();
  const d = new Date(now);
  if (now.getHours() >= 6) d.setDate(d.getDate() + 1);
  return dateToKey(d);
}

export function calendarDateKey(): string {
  return dateToKey(new Date());
}

export function parseDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatDateKey(key: string): string {
  const d = parseDateKey(key);
  return `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

export function todayLabelUpper(): string {
  const d = new Date();
  return `${WEEKDAYS[d.getDay()].toUpperCase()}, ${MONTHS[d.getMonth()].toUpperCase()} ${d.getDate()}`;
}

export function formatClock(d: Date): string {
  let h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${pad2(m)} ${ampm}`;
}
