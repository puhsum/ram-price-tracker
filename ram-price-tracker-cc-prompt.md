You are kicking off a brand-new project for me. Read this whole brief before you start, then build it in the milestone order at the bottom. This is a **learning project** — its real purpose is to teach me, Gabe your human counterpart, how REST APIs work — so favor clear, well-commented code over clever shortcuts, and at the points I mark **STOP AND EXPLAIN**, pause and walk me through what you just built before moving on.

Two rules that override everything else:
1. **When you need a secret or an account action I have to do myself** (API keys, database URLs, signing up for a service), **stop and ask me for it.** Never invent a fake key, and never skip the step to keep moving.
2. **Build one milestone at a time and make it work end-to-end before starting the next.** Do not scaffold all the endpoints at once.

---

## What we're building

A web dashboard that tracks the price of computer RAM kits on the Japanese market over time. A scheduled job pulls fresh prices from Rakuten every few hours and saves them to a database, so a price history builds up on its own. The dashboard shows a card per RAM kit with its current lowest price and a line chart of its price history.

The point is for me to learn **both sides of REST**: consuming someone else's REST API (Rakuten) and building my own (the dashboard's backend). Keep that framing alive in your comments.

**Scope:** "Japan / Tokyo prices" means online prices in JPY from the Rakuten Ichiba marketplace. Do **not** scrape any site, and do not add other data sources.

---

## Services I need to sign up for

Before or as we go, I'll create accounts on these. Each gives you a secret you'll ask me for:

- **Rakuten Developers** (webservice.rakuten.co.jp) → an `applicationId`. Free.
- **Neon** (neon.tech) → a Postgres connection string. Free tier.
- **Vercel** (vercel.com) → hosting + cron scheduling. Free Hobby tier.
- **GitHub** → the repo Vercel deploys from.

When you reach a step that needs one of these, **stop and ask me for the value.**

---

## Tech stack

- **TypeScript**, strict mode
- **Next.js** (App Router) — one project holds both the REST API (`app/api/` route handlers) and the dashboard frontend
- **Neon serverless Postgres**, accessed with the `@neondatabase/serverless` driver using **plain SQL** — no ORM, because I want to see real queries
- **Zod** for validating request bodies
- **Recharts** for the price charts
- **Vercel Cron** (via `vercel.json`) for scheduling

Keep dependencies minimal. Don't add an ORM, an auth library, or a component library unless a milestone here calls for it.

---

## Architecture

```
Rakuten Ichiba API  →  [Vercel Cron → /api/sync]  →  Neon Postgres  ←  [my REST API]  ←  Dashboard
   (external API,           (scheduled fetch)         (price history)   (my own routes)   (frontend)
    consumed)
```

I should be able to point at this and name the two REST surfaces: the external one you consume (Rakuten) and the internal one you build (my `/api/*` routes).

---

## Data model — two tables

Write this as a `schema.sql` file I can run against Neon.

**`products`** (the RAM kits I'm tracking)
- `id` — primary key
- `label` — display name, e.g. "Crucial 32GB DDR5-5600"
- `search_keyword` — what gets sent to Rakuten, e.g. "DDR5 32GB 5600"
- `created_at` — timestamptz, defaults to now

**`price_snapshots`** (one row per price observation)
- `id` — primary key
- `product_id` — foreign key → `products.id`
- `price` — integer, whole yen
- `shop_name` — the seller
- `item_url` — link to the listing
- `fetched_at` — timestamptz

---

## The REST API you'll build

Build these route handlers. I've noted the REST concept each one is meant to teach me — keep that in the comments.

| Method | Route | Purpose | Teaches |
|---|---|---|---|
| `POST` | `/api/products` | Add a kit to track | Validation; `201` vs `400` |
| `GET` | `/api/products` | List tracked kits | Collection resource |
| `GET` | `/api/products/:id` | One kit | Path params; `404` |
| `GET` | `/api/products/:id/history` | Price over time | Nested resource; query filter `?since=30d` |
| `DELETE` | `/api/products/:id` | Stop tracking | `204`; idempotency |
| `POST` | `/api/sync` | Fetch latest prices from Rakuten, insert snapshots | Internal endpoint guarded by a secret header |

Conventions to hold to everywhere:
- Return **correct HTTP status codes** — not `200` for everything. This is a core thing I'm trying to learn.
- Return consistent JSON error bodies, e.g. `{ "error": "..." }`.
- Validate all input with Zod; bad input → `400`.
- `/api/sync` must reject any call without the correct `Authorization: Bearer <CRON_SECRET>` header with a `401`.

---

## Consuming the Rakuten API

- Use the **Ichiba Item Search API**. Rakuten **date-versions** its endpoints (e.g. `.../IchibaItem/Search/20260701`), so **check the current endpoint URL and version against Rakuten's live docs before you hardcode anything** — don't trust the version written here.
- Auth is just `applicationId=<id>` as a query parameter. No OAuth.
- Search by `keyword` (the product's `search_keyword`) and sort cheapest-first with `sort=+itemPrice`.
- The response has an `Items` array; each `Item` has `itemName`, `itemPrice`, `shopName`, `itemUrl`. Take the cheapest relevant hit per product and insert one `price_snapshots` row.
- Rakuten throttles repeated identical queries, so the cron runs **every few hours, not minutes**, and you should put a small delay between per-product requests within a single sync run.

**STOP AND EXPLAIN:** Before you write any fetch code, give me the fully-formed Rakuten search URL with a placeholder for the `applicationId` and tell me to paste it into my browser to see the raw JSON. I want to see the unstyled response before you consume it in code.

---

## Environment variables

Create `.env.local` (git-ignored) and a committed `.env.example` with empty values:

```
RAKUTEN_APP_ID=      # from Rakuten Developers
DATABASE_URL=        # Neon connection string
CRON_SECRET=         # you generate a random string; it guards /api/sync
```

---

## Scheduling

Configure Vercel Cron in `vercel.json` to `POST /api/sync` every few hours (start with every 6). The cron call must send the `CRON_SECRET` so the endpoint authorizes it. Comment on why this is how a real system separates "a job the platform triggers" from "a route anyone could hit."

---

## Frontend

One page. For each tracked product, a card showing: label, current lowest price, the lowest-price shop (linked to the listing), and a Recharts line chart of its price history. Keep it clean and minimal — a readable card grid is plenty. The frontend pulls **everything** from my own API (`/api/products`, `/api/products/:id/history`), never from Rakuten directly. Keep that boundary strict.

---

## Build milestones — do them in this order

1. **Scaffold** — Next.js + TypeScript (strict), `.env.example`, `.gitignore`, README stub. Push to GitHub.
2. **Database** — write `schema.sql`; I'll run it on Neon; confirm a connection with a tiny script.
3. **Smallest REST loop** — `POST /api/products` and `GET /api/products`. **STOP AND EXPLAIN:** have me test both with `curl`, and make sure I see the `201` on success and a `400` on bad input before you continue.
4. **Sync job** — `/api/sync`: verify the Rakuten URL/version, fetch, insert snapshots. Trigger it manually and confirm rows land in Neon.
5. **Cron** — wire up `vercel.json`, deploy to Vercel, confirm the scheduled run fires and is authorized by the secret.
6. **History endpoint** — `GET /api/products/:id/history` with the `?since=` filter.
7. **Remaining routes** — `GET /api/products/:id` and `DELETE /api/products/:id`, with correct `404`/`204` behavior.
8. **Frontend** — the dashboard: card grid + history charts.
9. **Seed & observe** — add a few real RAM kits, let the cron run, watch the history accumulate.

---

## Out of scope for v1

User accounts/auth, price-drop notifications (a nice stretch goal later: `POST /api/alerts` + email/Discord), scraping, non-Rakuten sources, ORMs, component libraries.

---

## Done when

- All six endpoints behave with correct HTTP semantics (right status codes, validated input, JSON errors).
- The cron job runs on schedule and appends snapshots with no manual work.
- The dashboard shows live cards with working price-history charts, fed entirely by my own REST API.
- The `README.md` covers setup, the env vars, and includes the architecture diagram above.
- The code is commented well enough that someone new to REST could read a route handler and understand *why* it returns the status code it does.

Start with milestone 1. When you need my first secret, stop and ask.
