// /api/products -- the "collection" resource for RAM kits we track.
//
// REST idea being taught here: a single URL, `/api/products`, means two
// different things depending on the HTTP *method* you use against it.
// GET means "list everything in this collection". POST means "create a
// new member of this collection". The URL doesn't say which action --
// the verb does. That's the core idea of a REST resource.

import { z } from "zod";
import { sql } from "@/lib/db";
import { jsonError } from "@/lib/http";

// What a valid request body looks like. Both fields are required,
// non-empty strings -- anything else is a 400, not a crash.
const CreateProductSchema = z.object({
  label: z.string().trim().min(1, "label is required"),
  search_keyword: z.string().trim().min(1, "search_keyword is required"),
});

export async function GET() {
  const products = await sql`
    SELECT id, label, search_keyword, created_at
    FROM products
    ORDER BY created_at DESC
  `;

  // 200 OK: the request succeeded and here's the (possibly empty) collection.
  // An empty list is not an error -- it's a perfectly valid collection state.
  return Response.json(products, { status: 200 });
}

export async function POST(request: Request) {
  // A client can send anything as a body -- malformed JSON, the wrong
  // shape, missing fields. request.json() itself throws on bad JSON,
  // and Zod's safeParse catches everything else without throwing.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON", 400);
  }

  const result = CreateProductSchema.safeParse(body);
  if (!result.success) {
    // 400 Bad Request: the request is well-formed HTTP/JSON, but the
    // *content* fails our rules. This is the client's fault, not a
    // server error -- that distinction is exactly what 4xx vs 5xx means.
    return jsonError(result.error.issues[0]?.message ?? "Invalid request body", 400);
  }

  const { label, search_keyword } = result.data;

  const [product] = await sql`
    INSERT INTO products (label, search_keyword)
    VALUES (${label}, ${search_keyword})
    RETURNING id, label, search_keyword, created_at
  `;

  // 201 Created: a new resource now exists. Convention is to return the
  // resource you created (so the client doesn't have to re-fetch it) --
  // in a fuller API you'd also set a `Location: /api/products/{id}` header.
  return Response.json(product, { status: 201 });
}
