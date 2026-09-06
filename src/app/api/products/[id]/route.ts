// /api/products/:id -- a single product resource.
//
// Compare this file with ../route.ts (the collection). Same noun, different
// scope: `/api/products` is "all of them", `/api/products/3` is "that one".
// GET on the collection returns an array; GET here returns a single object,
// or 404 if there's nothing at that address. That pairing -- collection URL
// and member URL -- is the backbone of REST resource design.

import { sql } from "@/lib/db";
import { jsonError } from "@/lib/http";

/**
 * Path params are strings, and a URL like /api/products/abc is a valid URL
 * that simply doesn't name a valid product. Shared by both handlers below.
 */
function parseProductId(id: string): number | null {
  const productId = Number(id);
  if (!Number.isInteger(productId) || productId < 1) return null;
  return productId;
}

export async function GET(
  _request: Request,
  context: RouteContext<"/api/products/[id]">
) {
  const { id } = await context.params;

  // 400: we can't even look this up -- the request is malformed.
  const productId = parseProductId(id);
  if (productId === null) {
    return jsonError("Product id must be a positive integer", 400);
  }

  // A small convenience beyond the raw row: the most recent price we've seen.
  // The frontend's card needs exactly this, and computing it in one query
  // beats making the browser fetch the entire history just to read the last
  // element off it.
  const [product] = await sql`
    SELECT
      p.id,
      p.label,
      p.search_keyword,
      p.created_at,
      s.price      AS latest_price,
      s.shop_name  AS latest_shop_name,
      s.item_url   AS latest_item_url,
      s.fetched_at AS latest_fetched_at
    FROM products p
    LEFT JOIN LATERAL (
      SELECT price, shop_name, item_url, fetched_at
      FROM price_snapshots
      WHERE product_id = p.id
      ORDER BY fetched_at DESC
      LIMIT 1
    ) s ON true
    WHERE p.id = ${productId}
  `;

  // 404 Not Found: well-formed id, nothing at that address. This is the
  // difference between "your request was wrong" (400) and "your request was
  // fine, the thing just isn't here" (404).
  //
  // LEFT JOIN LATERAL means a product with no snapshots yet still comes back
  // (with null prices) rather than vanishing from the result -- a tracked
  // product that hasn't been synced yet definitely still exists.
  if (!product) {
    return jsonError(`No product with id ${productId}`, 404);
  }

  return Response.json(product, { status: 200 });
}

export async function DELETE(
  _request: Request,
  context: RouteContext<"/api/products/[id]">
) {
  const { id } = await context.params;

  const productId = parseProductId(id);
  if (productId === null) {
    return jsonError("Product id must be a positive integer", 400);
  }

  // Deleting the product also deletes its snapshots, because schema.sql
  // declares `ON DELETE CASCADE` on the foreign key. The database enforces
  // that rule, so no application code can forget it and leave orphaned rows.
  await sql`DELETE FROM products WHERE id = ${productId}`;

  // 204 No Content: it worked, and there is deliberately nothing to say.
  // Returning `{"deleted": true}` with a 200 would be redundant -- the status
  // code already carries that information. A 204 response has no body at all,
  // which is why this is `new Response(null, ...)` and not `Response.json`.
  //
  // IDEMPOTENCY: notice we don't check whether the row existed first, and we
  // return 204 either way. That's deliberate. An idempotent operation can be
  // repeated safely: DELETE twice leaves the world in exactly the same state
  // as DELETE once -- the product is gone. Since the client's goal ("make
  // this product not exist") is satisfied in both cases, both are successes.
  //
  // This matters practically: if a response gets lost to a flaky network and
  // the client retries, a 404 on the second attempt would report a failure
  // for an operation that actually succeeded.
  return new Response(null, { status: 204 });
}
