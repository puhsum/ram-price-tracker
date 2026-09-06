// Single shared entry point for talking to Neon. Every route handler
// imports `sql` from here rather than creating its own connection.
//
// `neon()` returns a tagged-template function: `sql\`SELECT ...\`` sends
// the query over HTTP (Neon's serverless driver, not a long-lived TCP
// connection -- the right fit for Vercel's request-scoped functions) and
// automatically parameterizes any ${values} you interpolate, which is
// what protects us from SQL injection. Never build query strings by hand.
import { neon } from "@neondatabase/serverless";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set (check .env.local)");
}

export const sql = neon(process.env.DATABASE_URL);
