// Tiny standalone script to confirm DATABASE_URL actually connects to Neon
// and that schema.sql has been run. Not part of the Next.js app -- run with:
//
//   node --env-file=.env.local scripts/check-db.mjs
//
// (--env-file is a built-in Node flag; Next.js loads .env.local on its own
// when the dev server runs, but a plain script needs this to see the var.)

import { neon } from "@neondatabase/serverless";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Did you pass --env-file=.env.local?");
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

const [{ now }] = await sql`SELECT now() AS now`;
console.log("Connected to Neon. Server time:", now);

const tables = await sql`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'public'
  ORDER BY table_name
`;
console.log(
  "Tables found:",
  tables.length ? tables.map((t) => t.table_name).join(", ") : "(none -- did you run schema.sql?)"
);
