# Personal Dashboard

A set of small, self-contained HTML apps that share a top bar.

## Deploy your own copy

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FRowanThistlebrooke%2FYTdashh1)

One click → Vercel signs you in, copies the repo to your GitHub, and deploys it. ~30 seconds to a live URL.

## How to use

Open any `.html` file directly in your browser — no build step, no install.

| File | What it is |
|---|---|
| [index.html](index.html) | Goals tracker (Day Ring, Goal Ticker, To Do list) — the home page |
| [health.html](health.html) | Supplement / daily stack tracker, with a live WHOOP recovery/sleep/strain card at the top |
| [po-water.html](po-water.html) | Water intake tracker |
| [finance.html](finance.html) | Finances |
| [gym.html](gym.html) | Progressive overload gym tracker |
| [topbar.js](topbar.js) | Shared top bar — auto-injected into pages that `<script src="topbar.js">` |

Each app stores its own state in browser `localStorage`. No accounts, no server.

## WHOOP setup (health.html)

The WHOOP card needs a backend, because WHOOP's OAuth token endpoint requires a client secret that can never reach the browser. This repo ships three Vercel serverless functions for that — `api/whoop-callback.js` (OAuth redirect target + token exchange), `api/whoop-refresh.js` (refreshes an expired access token), and `api/whoop-data.js` (proxies recovery/sleep/cycle reads) — they deploy automatically with the rest of the site on Vercel.

1. Create an app at [developer.whoop.com](https://developer.whoop.com) and grab its **Client ID** and **Client Secret**.
2. Register a **Redirect URI** there that points at the callback function itself, not a page: `https://your-site.vercel.app/api/whoop-callback`.
3. In your Vercel project settings, add environment variables `WHOOP_CLIENT_ID`, `WHOOP_CLIENT_SECRET`, and `WHOOP_REDIRECT_URI` (same value as step 2).
4. Open `health.html`, find `CLIENT_ID` in the WHOOP card's `<script>` block, and set it to your Client ID (this one is public, safe to hardcode — only the secret needs to stay server-side, in Vercel env vars).
5. Redeploy, open the Health page, and hit **Connect WHOOP**.

## Building from scratch

[BUILD_DASHBOARD.md](BUILD_DASHBOARD.md) is the prompt I gave Claude to generate `index.html` — paste it into Claude if you want to rebuild that page yourself.
