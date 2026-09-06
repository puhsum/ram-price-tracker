# RAM Price Tracker

A dashboard that tracks Japanese RAM kit prices on Rakuten Ichiba over time.
A scheduled job pulls fresh prices into Postgres once a day, and the dashboard
renders a price-history chart per kit.

This is also a learning project for **how REST APIs work** — both consuming
someone else's (Rakuten's) and building your own (this app's `/api/*`
routes). Route handlers are commented with the REST concept they demonstrate.

## Architecture

```
Rakuten Ichiba API  ->  [Vercel Cron -> /api/sync]  ->  Neon Postgres  <-  [my REST API]  <-  Dashboard
   (external API,           (scheduled fetch)         (price history)     (my own routes)    (frontend)
    consumed)
```

Two REST surfaces to point at:
- **External, consumed**: Rakuten's Ichiba Item Search API, called from `/api/sync`.
- **Internal, built here**: the `/api/products*` and `/api/sync` route handlers under `src/app/api/`.

## Tech stack

- TypeScript (strict mode)
- Next.js App Router — one project for both the REST API and the frontend
- Neon serverless Postgres via `@neondatabase/serverless`, plain SQL (no ORM)
- Zod for request validation
- Recharts for price-history charts
- Vercel Cron for scheduling

## Setup

1. Install dependencies:
   ```
   npm install
   ```
2. Copy `.env.example` to `.env.local` and fill in the values (see below).
3. Run the dev server:
   ```
   npm run dev
   ```

## Environment variables

| Variable | Where it comes from | Purpose |
|---|---|---|
| `RAKUTEN_APP_ID` | [Rakuten Developers](https://webservice.rakuten.co.jp/) (free) | Query-param auth for the Ichiba Item Search API |
| `RAKUTEN_ACCESS_KEY` | Issued alongside the app ID | Also required since Rakuten's 2026 security change — the app ID alone is rejected |
| `DATABASE_URL` | [Neon](https://neon.tech) (free tier) | Postgres connection string for `products` / `price_snapshots` |
| `CRON_SECRET` | You generate a random string | Bearer token that `/api/sync` requires, so only the Vercel Cron job (not the public internet) can trigger a fetch |

## Scheduling (Vercel Cron)

`vercel.json` schedules a daily run:

```json
{ "crons": [{ "path": "/api/sync", "schedule": "0 3 * * *" }] }
```

Three things about this are worth understanding, because each one is a
platform constraint that overrode the "obvious" design:

**Why once a day, not every 6 hours.** Vercel's Hobby (free) plan allows cron
jobs to run *at most once per day* — a more frequent expression like
`0 */6 * * *` doesn't just get throttled, it **fails the deployment**. Hobby
crons also fire at any point within the scheduled hour, so `0 3 * * *` means
"sometime between 03:00 and 03:59 UTC." More frequent snapshots would require
a paid plan.

**Why `/api/sync` answers to GET as well as POST.** POST is the semantically
correct verb for a call with side effects; GET is supposed to be *safe*
(no observable server change). But Vercel Cron only ever issues **GET**
requests to the configured path, so a POST-only endpoint would return `405`
on every scheduled run. The route therefore accepts both: GET for the
scheduler, POST for manual triggering.

**Why there's no history before the day you started.** Rakuten has no
historical-price API — every endpoint it offers (Ichiba, Books, Travel, Kobo,
GORA, Recipe) returns *current* listings only. Nothing anywhere will tell you
what a kit cost last March. This app's history exists solely because the cron
job records a snapshot each day and never overwrites one; the chart can only
ever start from the first sync. Backfilling earlier dates would mean inventing
numbers, which is worse than a short chart.

**Getting denser data than once a day.** The daily cap is Vercel's free tier,
not a limit of this app — `/api/sync` is just an HTTPS endpoint behind a bearer
token, so *anything* on a timer can drive it. A free GitHub Actions scheduled
workflow hitting it hourly would give ~24 points per kit per day. (Trade-off:
GitHub disables scheduled workflows after 60 days without a commit, whereas
Vercel's cron keeps running untouched.) Upgrading Vercel to Pro also lifts the
cap. That the scheduler is swappable at all is a consequence of separating
*the job* from *the thing that triggers the job*.

**Why the secret matters.** A route handler is just a URL, and a URL is
reachable by anyone who guesses it — being "the cron endpoint" grants no
privacy on its own. `/api/sync` requires `Authorization: Bearer <CRON_SECRET>`
and returns `401` otherwise. Vercel sends that exact header automatically when
a `CRON_SECRET` environment variable is set on the project, so the scheduled
job authorizes itself with no extra wiring. That single header is the entire
difference between "a job the platform triggers" and "a route anyone could
hit" — which also keeps the GET defensible, since nothing can casually
prefetch or cache it into running.

## The REST API

| Method | Route | Purpose | REST concept it demonstrates |
|---|---|---|---|
| `POST` | `/api/products` | Add a kit to track | Validation; `201` vs `400` |
| `GET` | `/api/products` | List tracked kits | Collection resource |
| `GET` | `/api/products/:id` | One kit + its latest price | Path params; `404` |
| `GET` | `/api/products/:id/history` | Price over time | Nested resource; `?since=30d` filter |
| `DELETE` | `/api/products/:id` | Stop tracking | `204`; idempotency |
| `GET`/`POST` | `/api/sync` | Fetch prices from Rakuten | Secret-guarded internal endpoint; `401` |

Conventions held everywhere: real status codes (never `200` for everything),
consistent `{ "error": "..." }` bodies, and Zod validation on all input.

`?since=` accepts `30d`, `12h` or `90m`; anything else is a `400`.

## Database

`schema.sql` defines two tables: `products` (the kits being tracked) and
`price_snapshots` (one row per price observation). Run it against your Neon
database once, before first use.

Snapshots are **append-only** — the sync job never updates an existing row.
That's what makes a price history accumulate by itself, and it makes a
duplicate cron run harmless rather than destructive.

## Choosing a `search_keyword`

This is the one part that needs human judgement, and getting it wrong produces
confident, wrong data.

Rakuten has **variant listings**: a single page selling 8/16/32/64GB of the
same stick. On those, `itemPrice` is the price of the *cheapest* variant — so a
loose keyword like `DDR5 32GB 5600` will happily report an 8GB stick's price
under a 32GB label. Exact model numbers help but don't fully solve it:
searching `CT2K16G56C46U5` (a 32GB kit) still surfaces a variant page priced
from ¥37,010, when genuine listings for that kit start around ¥92,000.

Two defences:

1. **The sync job skips variant listings.** It walks results cheapest-first and
   ignores any page whose dearest variant exceeds its cheapest by more than
   1.5x. If nothing is left, it records *nothing* — a gap in the chart is
   honest, a plausible-looking wrong number isn't.
2. **Test a keyword before adding it:**
   ```
   node --env-file=.env.local scripts/check-keyword.mjs "CP2K16G56C46U5"
   ```
   It prints what Rakuten would return and flags variant listings, without
   writing anything to the database. Keywords returning 0 results, or only
   variant pages, are bad keywords — pick a different model number.

## Helper scripts

All read-only except where noted; run them with Node's `--env-file` flag so
they can see `.env.local`:

| Script | What it does |
|---|---|
| `scripts/check-db.mjs` | Confirms `DATABASE_URL` connects and lists tables |
| `scripts/show-snapshots.mjs` | Prints the 20 most recent price snapshots |
| `scripts/check-keyword.mjs "<kw>"` | Previews Rakuten results for a keyword |
| `scripts/delete-snapshot.mjs <id>` | **Writes.** Deletes a snapshot row, for correcting bad data |

## Project status

All nine build milestones are complete: the six endpoints, the scheduled sync,
and the dashboard are live. Price history accumulates one snapshot per kit per
day with no manual work.
