// Delete a single price snapshot by id. For correcting bad data -- e.g. a row
// recorded from a variant listing before the relevance filter was deployed.
//
// Usage: node --env-file=.env.local scripts/delete-snapshot.mjs <id> [<id>...]

import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

const ids = process.argv.slice(2).map(Number).filter(Number.isInteger);
if (ids.length === 0) {
  console.error("Usage: node --env-file=.env.local scripts/delete-snapshot.mjs <id> [<id>...]");
  process.exit(1);
}

for (const id of ids) {
  const rows = await sql`
    DELETE FROM price_snapshots WHERE id = ${id}
    RETURNING id, price, shop_name
  `;
  console.log(
    rows.length
      ? `Deleted snapshot #${rows[0].id} (JPY ${rows[0].price}, ${rows[0].shop_name})`
      : `No snapshot #${id}`
  );
}
