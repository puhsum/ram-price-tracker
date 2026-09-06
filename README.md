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

## Database

`schema.sql` defines two tables: `products` (the kits being tracked) and
`price_snapshots` (one row per price observation). Run it against your Neon
database before starting milestone 3.

## Project status

Being built milestone-by-milestone — see `ram-price-tracker-cc-prompt.md` for
the full build plan. Currently on: **Milestone 1 — scaffold**.
