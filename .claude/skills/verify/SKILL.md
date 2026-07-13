---
name: verify
description: Build, run, and drive the bento dashboard (Next.js) to verify changes end-to-end with Playwright.
---

# Verifying the bento dashboard

## Build & launch

```bash
npm run build                      # must pass typecheck
npm run start -- -p 3789 &         # prod server; if EADDRINUSE: lsof -ti :3789 | xargs kill -9
curl -s http://localhost:3789/ | grep -c Aamir   # 2 = shell rendered
```

## Drive it

Playwright is a devDependency and chromium is cached (`~/Library/Caches/ms-playwright`).
Scripts must live **inside the repo** (module resolution) — use a `.tmp.mjs` at the
root and delete it after.

**IMPORTANT — block external hosts.** The app syncs to the user's real Supabase
(`app_state` rows: goals/health/po-coach/finance). Any write in a test browser
would push test data into real rows. Always:

```js
await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
```

(Realtime WebSockets are not intercepted by `route` — reads only, acceptable.)

## Flows worth driving

- Cards: `button[aria-label="Open Goals|Stack|Water|Gym|Finance"]` → expands to `/?p=<id>`
- Close: Escape, backdrop click, browser Back — all should return to `/`
- Header water `+1`: `button[aria-label="Log one drink"]` updates the pill + Water tile
- Deep links `/?p=stack`, legacy redirect `/gym.html → /?p=gym`
- Seed state via `page.evaluate(localStorage.setItem(...))` — goals key is
  `goals:YYYY-MM-DD` with the **6 AM rollover** (before 6 AM = yesterday's date)

## Gotchas

- Page content is client-rendered from localStorage; wait ~1s after load.
- A blank white page usually means the port is served by a half-dead old server,
  not an app crash — kill by port, not by `pkill -f "next start"`.
- Gym default filters auto-snap to today's split; the seeded default exercise may
  be bodyweight (pull-ups), so "0 kg lifted" after logging a set is correct.
