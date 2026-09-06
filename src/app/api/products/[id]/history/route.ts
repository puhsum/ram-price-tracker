// GET /api/products/:id/history -- price observations for one product.
//
// REST ideas being taught here:
//
// 1. NESTED RESOURCES. The URL reads as a sentence: "the history *of*
//    product 3." Price snapshots don't have a meaningful life of their own --
//    a snapshot only means something in the context of the product it belongs
//    to. When a child resource is owned like that, nesting it under the parent
//    is clearer than a flat /api/snapshots?product_id=3.
//
// 2. QUERY PARAMETERS AS FILTERS. `?since=30d` doesn't identify a *different*
//    resource -- it's the same history, narrowed. That's the dividing line
//    between path segments and query strings: the path says WHAT you want,
//    the query says WHICH SUBSET of it. This is why filtering, sorting, and
//    pagination all belong in the query string.
//
// 3. 404 vs 400 vs an empty list -- three different "nothing here" answers
//    that mean genuinely different things. See the comments below.

import { z } from "zod";
import { sql } from "@/lib/db";
import { jsonError } from "@/lib/http";

// `?since=30d` / `?since=12h` / `?since=90m`. A number followed by a unit:
// d(ays), h(ours) or m(inutes). Validating with a regex means "30x", "-5d"
// and "abc" are rejected up front with a clear 400, instead of quietly
// becoming a nonsense date.
const SinceSchema = z
  .string()
  .regex(/^\d+[dhm]$/, "since must look like '30d', '12h' or '90m'");

const DEFAULT_SINCE = "30d";

const MINUTES_PER_UNIT = { m: 1, h: 60, d: 60 * 24 } as const;

/** Turn "30d" into the actual timestamp 30 days ago. */
function resolveSince(since: string): Date {
  const amount = Number(since.slice(0, -1));
  const unit = since.slice(-1) as keyof typeof MINUTES_PER_UNIT;
  const minutes = amount * MINUTES_PER_UNIT[unit];
  return new Date(Date.now() - minutes * 60 * 1000);
}

export async function GET(
  request: Request,
  context: RouteContext<"/api/products/[id]/history">
) {
  // In this version of Next.js, route params arrive as a Promise and must be
  // awaited -- they aren't known until the request is actually being handled.
  const { id } = await context.params;

  // Path params are always strings: the URL /api/products/abc is a perfectly
  // valid URL, it just isn't a valid *product id*. 400 rather than 404,
  // because the request itself is malformed -- we can't even look this up.
  const productId = Number(id);
  if (!Number.isInteger(productId) || productId < 1) {
    return jsonError("Product id must be a positive integer", 400);
  }

  // `searchParams` gives us the already-decoded query string.
  const rawSince = new URL(request.url).searchParams.get("since");
  const sinceResult = SinceSchema.safeParse(rawSince ?? DEFAULT_SINCE);
  if (!sinceResult.success) {
    return jsonError(
      sinceResult.error.issues[0]?.message ?? "Invalid 'since' parameter",
      400
    );
  }
  const cutoff = resolveSince(sinceResult.data);

  // Check the parent exists before returning its children. Without this,
  // asking for a product that was never created would return `[]` -- which
  // wrongly implies "this product exists and simply has no prices yet."
  const [product] = await sql`
    SELECT id, label, search_keyword FROM products WHERE id = ${productId}
  `;

  // 404 Not Found: the id is well-formed, we looked, there's nothing there.
  if (!product) {
    return jsonError(`No product with id ${productId}`, 404);
  }

  // Note we pass a real Date as a bound parameter rather than splicing an
  // interval string into the SQL. The driver parameterizes ${cutoff}, so
  // there's no way for a query param to become executable SQL.
  //
  // Ascending order because this feeds a time-series chart, and a line chart
  // wants its points oldest-to-newest.
  const snapshots = await sql`
    SELECT id, price, shop_name, item_url, fetched_at
    FROM price_snapshots
    WHERE product_id = ${productId}
      AND fetched_at >= ${cutoff.toISOString()}
    ORDER BY fetched_at ASC
  `;

  // 200 with an empty `snapshots` array is the right answer for "this product
  // exists but has no prices in this window" -- an empty result set is a
  // successful query, not an error. Compare with the 404 above: that one says
  // "the thing you asked about doesn't exist at all."
  return Response.json(
    {
      product,
      since: sinceResult.data,
      count: snapshots.length,
      snapshots,
    },
    { status: 200 }
  );
}
