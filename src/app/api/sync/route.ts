// POST /api/sync -- fetch current prices from Rakuten and record them.
//
// REST idea being taught here: not every endpoint is a public CRUD resource.
// This one is a *job trigger*. It exists so a scheduler (Vercel Cron) can say
// "go do the work now." But a route handler is just a URL, and a URL is
// reachable by anyone who guesses it. Nothing about being "for the cron job"
// makes it private -- so we have to enforce that ourselves, with a shared
// secret. That's the difference between "a job the platform triggers" and
// "a route anyone could hit": only the Authorization header.

import { sql } from "@/lib/db";
import { jsonError } from "@/lib/http";
import { fetchCheapestItem } from "@/lib/rakuten";

// Be polite to Rakuten between per-product requests. Rakuten throttles
// repeated identical queries, and the cron only runs every few hours, so a
// short pause costs us nothing and keeps us well clear of rate limits.
const DELAY_BETWEEN_REQUESTS_MS = 1000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type Product = {
  id: number;
  label: string;
  search_keyword: string;
};

export async function POST(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    // 500, not 401: the caller did nothing wrong -- the server is misconfigured.
    // Getting this distinction right is what 4xx vs 5xx is for.
    return jsonError("CRON_SECRET is not configured on the server", 500);
  }

  // 401 Unauthorized: "I don't know who you are." The header is either absent
  // or wrong. Note we return the SAME response for both cases and don't say
  // which -- telling an attacker "close, but the secret is wrong" is free
  // information. (403 Forbidden would mean "I know who you are, but you're
  // not allowed"; that's not the situation here.)
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return jsonError("Unauthorized", 401);
  }

  const products = (await sql`
    SELECT id, label, search_keyword
    FROM products
    ORDER BY id
  `) as Product[];

  const results: Array<{
    product_id: number;
    label: string;
    status: "recorded" | "no_results" | "error";
    price?: number;
    message?: string;
  }> = [];

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
