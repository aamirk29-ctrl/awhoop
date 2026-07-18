// Pre-filled "Add to Google Calendar" link builder. No auth, no network call,
// no secrets — the old planner's calendar integration was an unauthenticated
// fetch() to api.anthropic.com with an invented endpoint and never worked, so
// there's nothing to port. This opens Google's own event-creation screen with
// the fields pre-filled; the user clicks Save there, which doubles as the
// human confirm step.

function toGcalStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

export function buildGcalLink(title: string, start: Date, end: Date, details?: string): string {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates: `${toGcalStamp(start)}/${toGcalStamp(end)}`,
  });
  if (details) params.set('details', details);
  return `https://www.google.com/calendar/render?${params.toString()}`;
}
