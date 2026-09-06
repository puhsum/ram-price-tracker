// /api/sync -- fetch current prices from Rakuten and record them.
//
// REST idea being taught here: not every endpoint is a public CRUD resource.
// This one is a *job trigger*. It exists so a scheduler (Vercel Cron) can say
// "go do the work now." But a route handler is just a URL, and a URL is
// reachable by anyone who guesses it. Nothing about being "for the cron job"
// makes it private -- so we have to enforce that ourselves, with a shared
// secret. That's the whole difference between "a job the platform triggers"
// and "a route anyone could hit": one Authorization header.
//
// Why this endpoint answers to BOTH GET and POST:
//
//   POST is the semantically correct verb -- this call has side effects, it
//   writes rows. GET is supposed to be *safe* (no observable change on the
//   server), which is why you can refresh a GET without a "resend form?"
//   warning and why proxies feel free to cache and prefetch them.
//
//   But Vercel Cron only ever issues GET requests to the path in vercel.json.
//   So the platform hands us a constraint that overrides the textbook answer:
//   support GET, or the scheduled job returns 405 forever.
//
// This is a genuinely common shape in real systems -- the "correct" verb for
// humans and scripts, plus whatever verb the scheduler insists on. What keeps
// it defensible is that the GET is not publicly reachable: without the secret
// it's a 401, so nothing can casually prefetch or cache it into running.

import { sql } from "@/lib/db";
import { jsonError } from "@/lib/http";
import { fetchCheapestItem } from "@/lib/rakuten";

// Be polite to Rakuten between per-product requests. Rakuten throttles
// repeated identical queries, and the cron only runs once a day, so a short
// pause costs us nothing and keeps us well clear of rate limits.
const DELAY_BETWEEN_REQUESTS_MS = 1000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type Product = {
  id: number;
  label: string;
  search_keyword: string;
};

type SyncResult = {
  product_id: number;
  label: string;
  status: "recorded" | "no_results" | "error";
  price?: number;
  message?: string;
};

/**
 * The actual work, shared by both verbs. Auth has already been checked by
 * the time we get here.
 */
async function runSync(): Promise<Response> {
  const products = (await sql`
    SELECT id, label, search_keyword
    FROM products
    ORDER BY id
  `) as Product[];

  const results: SyncResult[] = [];

  for (const [index, product] of products.entries()) {
    // Space out calls to Rakuten -- but don't sleep before the first one, or
    // after the last one, since there's nothing to space out from.
    if (index > 0) await sleep(DELAY_BETWEEN_REQUESTS_MS);

    try {
      const hit = await fetchCheapestItem(product.search_keyword);

      if (!hit) {
        // No listings matched. That's a fact about the market, not a failure,
        // so we record nothing and carry on to the next product.
        results.push({
          product_id: product.id,
          label: product.label,
          status: "no_results",
        });
        continue;
      }

      // One row per observation -- we never UPDATE an existing price. That
      // append-only design is what makes a price *history* accumulate on its
      // own, and it's why the history endpoint has anything to chart.
      //
      // It also makes this job naturally safe to run twice: a duplicate run
      // adds a redundant snapshot, it doesn't corrupt anything. Vercel warns
      // that cron delivery is best-effort and can occasionally double-fire,
      // so "a duplicate run is harmless" is a property worth having.
      await sql`
        INSERT INTO price_snapshots (product_id, price, shop_name, item_url)
        VALUES (${product.id}, ${hit.price}, ${hit.shopName}, ${hit.itemUrl})
      `;

      results.push({
        product_id: product.id,
        label: product.label,
        status: "recorded",
        price: hit.price,
      });
    } catch (error) {
      // One product failing (a Rakuten hiccup, an unexpected response shape)
      // must not abort the whole run -- the other products still deserve
      // their snapshot. We collect the error and keep going.
      results.push({
        product_id: product.id,
        label: product.label,
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // 200 OK rather than 201 Created. We did create rows, but the *response*
  // here is a report on a job run, not a newly created resource you can go
  // fetch at some URL. 201 would imply "here is the thing you made, at this
  // address" -- that's not what a sync run gives you.
  return Response.json(
    {
      synced_at: new Date().toISOString(),
      products_checked: products.length,
      snapshots_recorded: results.filter((r) => r.status === "recorded").length,
      results,
    },
    { status: 200 }
  );
}

/**
 * Shared gate for both verbs. Returns a Response to send back if the caller
 * failed the check, or null if they're authorized to proceed.
 */
function checkAuthorization(request: Request): Response | null {
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    // 500, not 401: the caller did nothing wrong -- the server is
    // misconfigured. Getting this distinction right is what 4xx vs 5xx is for.
    // 4xx = "you have a problem", 5xx = "I have a problem".
    return jsonError("CRON_SECRET is not configured on the server", 500);
  }

  // 401 Unauthorized: "I don't know who you are." The header is either absent
  // or wrong. Note we return the SAME response for both cases and don't say
  // which -- telling an attacker "close, but the secret is wrong" is free
  // information. (403 Forbidden would mean "I know who you are, but you're
  // not allowed"; that's not the situation here.)
  //
  // Vercel sends this exact header automatically when a CRON_SECRET env var
  // is set on the project, which is why the scheduled job authorizes itself
  // with no extra configuration on our side.
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return jsonError("Unauthorized", 401);
  }

  return null;
}

/** Triggered by Vercel Cron (which only ever sends GET). */
export async function GET(request: Request) {
  return checkAuthorization(request) ?? runSync();
}

/** Triggered manually -- by curl, or by you from your own machine. */
export async function POST(request: Request) {
  return checkAuthorization(request) ?? runSync();
}
