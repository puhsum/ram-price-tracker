# Project notes / session context

Living context for anyone (human or agent) picking this project up. The full
original brief is in `ram-price-tracker-cc-prompt.md`; the README covers setup
and the REST API. **This file records what was decided and why** — the things
that aren't obvious from reading the code.

Last updated: **6 September 2026**.

---

## What this is

A dashboard tracking RAM kit prices on the Japanese Rakuten Ichiba marketplace.
A daily cron pulls current prices into Postgres so a price history accumulates.

**Its real purpose is teaching Gabe how REST APIs work** — both consuming
someone else's (Rakuten) and building your own (`/api/*`). That's why route
handlers carry long comments explaining *why* they return the status codes they
do. **Keep that commenting style** — it's the point of the project, not clutter.

Working style Gabe asked for, worth preserving:
- Explain what was built before moving on; pause at meaningful checkpoints.
- **Never invent a secret or skip a step needing his account** — stop and ask.
- One milestone at a time, working end-to-end before starting the next.

## Status: complete and live

All nine milestones done and deployed.

- Repo: https://github.com/puhsum/ram-price-tracker
- Live: https://ram-price-tracker-teal.vercel.app
- Database: Neon Postgres (free tier), `ap-southeast-1`

Six endpoints (`POST`/`GET /api/products`, `GET`/`DELETE /api/products/:id`,
`GET /api/products/:id/history`, `GET`/`POST /api/sync`), all verified by hand
for correct status codes. Dashboard renders card grid + Recharts line charts,
fed entirely by the app's own API.

## Secrets — where they live

Values are in `.env.local` (git-ignored) and in Vercel's project env vars.
**Never commit them.** Four are needed: `RAKUTEN_APP_ID`,
`RAKUTEN_ACCESS_KEY`, `DATABASE_URL`, `CRON_SECRET`. See `.env.example`.

---

## Hard-won gotchas — do not re-derive these

**1. Rakuten overhauled its API in 2026.** The host is
`openapi.rakuten.co.jp` (not the old `app.rakuten.co.jp`), the current version
is `.../IchibaItem/Search/20260701`, and **both `applicationId` and `accessKey`
are required** — the app ID alone is rejected. Older tutorials and the original
brief are out of date. Re-check the live docs before changing the endpoint.

**2. The live response shape is `Items[].Item.field`** — capitalised and
nested. Some docs describe lowercase `items[].item` (that's `formatVersion=2`).
This was confirmed against a real response, not documentation.

**3. Rakuten's app registration has an IP allowlist**, and Vercel's free tier
has **no fixed outbound IP** (static IPs are ~$100/mo on Pro+). The allowlist is
set to `0.0.0.0/0`, which was verified to work from Vercel's servers. Don't
"tighten" it to a specific IP or production sync will start failing.

**4. Variant listings poison the data.** Rakuten sells 8/16/32/64GB of one
stick on a single page, where `itemPrice` is the *cheapest variant*. A search
for a 32GB kit can therefore report an 8GB stick's price. Exact model numbers
help but don't fully solve it. `src/lib/rakuten.ts` skips any listing whose
dearest variant exceeds its cheapest by >1.5x, and records nothing rather than
a wrong number. **Always test a keyword before adding a product:**
`node --env-file=.env.local scripts/check-keyword.mjs "<model number>"`.

**5. Vercel Cron sends `GET`, never `POST`.** That's why `/api/sync` exports
both verbs — a POST-only route would 405 on every scheduled run.

**6. Vercel Hobby caps cron at once per day.** A more frequent expression
(`0 */6 * * *`) **fails the deployment**; it isn't merely throttled. Hobby crons
also fire anywhere within the scheduled hour.

**7. Next.js 16: route params are a Promise.** Use
`context: RouteContext<'/api/products/[id]'>` then `await context.params`. Also,
plain `npx tsc --noEmit` fails on Next's generated global types — type-check
with `npm run build` instead.

**8. `setState` synchronously inside `useEffect` is a lint error** in this
React version. `dashboard.tsx` sets state in promise callbacks and flags
refetches from the click handler instead.

---

## Decisions made deliberately

**No historical backfill — ever.** Rakuten has **no historical price API**
(verified across their whole catalogue). History exists only because the cron
records it, so charts start at the first sync (6 Sept 2026). Gabe asked for a
year of monthly points; this was declined because the only way to produce them
is to fabricate numbers and write them beside real observations. **Do not seed
fake prices into `price_snapshots`.**

**Daily cadence, deliberately chosen.** Gabe was offered a free GitHub Actions
hourly sync (~24× the data; `/api/sync` already supports it, no code changes)
and **chose to stay on Vercel's daily cron** for zero maintenance. Don't add it
unless he asks. Caveat if he ever does: GitHub disables scheduled workflows
after 60 days without a commit.

**Snapshots are append-only.** Never `UPDATE` a price row. This is what makes
history accumulate and makes a duplicate cron run harmless.

**No ORM, no component library, no auth library.** Plain SQL so the queries are
visible; the brief wants them readable.

---

## Currently tracked products

Seeded 6 Sept 2026. Every keyword was verified against Rakuten first.

| id | Label | `search_keyword` |
|---|---|---|
| 4 | Crucial PRO 32GB (2x16) DDR5-5600 | `CP2K16G56C46U5` |
| 5 | Corsair Vengeance 32GB (2x16) DDR5-6000 | `CMK32GX5M2B6000C30` |
| 6 | Kingston FURY Beast 32GB (2x16) DDR5-5600 | `KF556C40BBK2-32` |
| 7 | Crucial 32GB (2x16) DDR5-5600 | `CT2K16G56C46U5` |
| 8 | Crucial 8GB (1x8) DDR5-5600 | `CT8G56C46U5` |
| 9 | Crucial 16GB (1x16) DDR5-5600 | `CT16G56C46U5` |
| 10 | Crucial 16GB (2x8) DDR5-5600 | `CT2K8G56C46U5` |

Keywords that returned **0 results** and were rejected (don't retry blindly):
`F5-6000J3038F16GX2-TZ5RK`, `CMK16GX5M2B5600C40`, `KF556C40BBK2-16`,
`CMK16GX5M2B6000C36`.

**Data state as of 6 Sept 2026:** only manual-trigger snapshots exist. The
first genuine scheduled run is due 7 Sept, 03:00–03:59 UTC (12:00–12:59 JST).

**Open question flagged to Gabe, unresolved:** the recorded prices look high
(~¥95k for a 32GB DDR5 kit, ~¥28k for an 8GB stick). The pipeline records what
Rakuten returns and variant listings are filtered out, but whether these
particular *listings* reflect the real Japanese market is a judgement call he
hasn't made yet. If they're wrong, the fix is better keywords, not code.

---

## Possible next steps (none started)

- Let history accumulate, then revisit the charts once lines have shape.
- Stretch goal from the brief: `POST /api/alerts` + email/Discord price-drop
  notifications.
- A UI for adding/removing tracked kits (currently `curl` only).
- Revisit keyword quality if prices look off.
