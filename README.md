# Personal Dashboard — Bento Edition

A Next.js dashboard where five self-tracking apps live in one dark bento grid:
**Goals · Stack (supplements + WHOOP) · Water · Gym · Finance**. Each tile shows
a live metric; clicking a tile expands it in place (shared-layout animation)
into the full app.

Built from the original static-HTML pages (now archived in [`legacy/`](legacy/))
— the data layer is unchanged: same localStorage keys, same Supabase `app_state`
rows (`goals`, `health`, `po-coach`, `finance`), so existing data and multi-device
sync carry over as-is.

## Develop

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # production build
```

## Structure

| Path | What it is |
|---|---|
| `app/page.tsx` | Bento dashboard — greeting, status pills, 5 tiles, CTA banner, expand-in-place routing (`/?p=goals` … `/?p=finance`) |
| `components/ui/aurora-bento-grid.tsx` | AuroraBackground / BentoGrid / BentoGridItem / BentoExpandedOverlay (motion `layoutId` transitions) |
| `components/panels/` | The five full apps, one per panel |
| `components/whoop-card.tsx` | Live WHOOP recovery/sleep/strain card (inside Stack) |
| `lib/` | Data layer: reactive localStorage store, multi-channel Supabase sync, per-domain models (water, gym, finance, supplements) |
| `app/api/whoop-*` | WHOOP OAuth callback, token refresh, and data proxy (client secret stays server-side) |
| `legacy/` | The original standalone HTML pages, kept for reference |

Old bookmarks (`/gym.html` etc.) redirect to the matching expanded panel.

## WHOOP setup

The WHOOP card needs three route handlers (deployed automatically with the app)
because WHOOP's token endpoint requires a client secret that can never reach the
browser.

1. Create an app at [developer.whoop.com](https://developer.whoop.com) — grab its **Client ID** and **Client Secret**.
2. Register the **Redirect URI** `https://your-site.vercel.app/api/whoop-callback`.
3. In Vercel project settings, set env vars `WHOOP_CLIENT_ID`, `WHOOP_CLIENT_SECRET`, `WHOOP_REDIRECT_URI` (same value as step 2).
4. Set `CLIENT_ID` in `components/whoop-card.tsx` to your Client ID (public — only the secret must stay server-side).
5. Deploy, open the Stack panel, hit **Connect WHOOP**.

## Sync

`lib/cloud-sync.ts` mirrors each domain to one row of the Supabase `app_state`
table and subscribes to realtime changes, so edits appear on other devices within
~1 second. Leave the Supabase constants as placeholders for a local-only build.
