# RAM Price Tracker

A dashboard that tracks Japanese RAM kit prices on Rakuten Ichiba over time.
A scheduled job pulls fresh prices every few hours into Postgres, and the
dashboard renders a price-history chart per kit.

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

**Why the secret matters.** A route handler is just a URL, and a URL is
reachable by anyone who guesses it — being "the cron endpoint" grants no
privacy on its own. `/api/sync` requires `Authorization: Bearer <CRON_SECRET>`
and returns `401` otherwise. Vercel sends that exact header automatically when
a `CRON_SECRET` environment variable is set on the project, so the scheduled
job authorizes itself with no extra wiring. That single header is the entire
difference between "a job the platform triggers" and "a route anyone could
hit" — which also keeps the GET defensible, since nothing can casually
prefetch or cache it into running.

## Database

`schema.sql` defines two tables: `products` (the kits being tracked) and
`price_snapshots` (one row per price observation). Run it against your Neon
database before starting milestone 3.

## Project status

Being built milestone-by-milestone — see `ram-price-tracker-cc-prompt.md` for
the full build plan. Currently on: **Milestone 1 — scaffold**.
