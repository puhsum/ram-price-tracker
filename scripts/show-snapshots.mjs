// Quick look at what's actually in the database. Handy for confirming the
// sync job did what its response claimed. Run with:
//
//   node --env-file=.env.local scripts/show-snapshots.mjs

import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

const rows = await sql`
  SELECT s.id, p.label, s.price, s.shop_name, s.item_url, s.fetched_at
  FROM price_snapshots s
  JOIN products p ON p.id = s.product_id
  ORDER BY s.fetched_at DESC
  LIMIT 20
`;

if (rows.length === 0) {
  console.log("No snapshots yet.");
} else {
  for (const r of rows) {
    console.log(
      `#${r.id}  ${r.fetched_at.toISOString()}  ${r.label}  JPY ${r.price.toLocaleString()}  [${r.shop_name}]`
    );
    console.log(`     ${r.item_url}`);
  }
}
