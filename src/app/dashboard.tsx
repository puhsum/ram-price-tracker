"use client";

// The dashboard.
//
// THE BOUNDARY THAT MATTERS: this component talks only to our own REST API --
// GET /api/products and GET /api/products/:id/history. It never calls Rakuten.
// That's not just tidiness:
//
//   * Rakuten authenticates with credentials in the query string. Calling it
//     from the browser would ship those keys to every visitor.
//   * The browser would be reading *live* prices, not our recorded history --
//     there'd be nothing to chart.
//   * Our own API is the contract. Swap Rakuten for another source tomorrow
//     and this file doesn't change at all.
//
// Open your browser's Network tab while this page loads: every request goes to
// localhost/vercel, none to rakuten.co.jp. That's the boundary, visible.

import { useEffect, useState } from "react";
import { PriceChart } from "./price-chart";
import type { History, Product } from "./types";
import styles from "./dashboard.module.css";

const yen = new Intl.NumberFormat("ja-JP", {
  style: "currency",
  currency: "JPY",
  maximumFractionDigits: 0,
});

const dateTime = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
});

// Presets for the `?since=` filter our history endpoint already supports.
// Date range first, as rows -- nobody fights a calendar widget for "last 30 days".
const RANGES = [
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
] as const;

/**
 * Fetch every tracked product plus its price history, in two steps against our
 * own REST API. Deliberately free of React state -- it just does the I/O and
 * returns data, which keeps the network code readable on its own and lets the
 * component decide what to do with the result.
 */
async function fetchDashboardData(range: string): Promise<History[]> {
  // Step 1: the collection resource -- which products are we tracking?
  const productsRes = await fetch("/api/products");
  if (!productsRes.ok) {
    throw new Error(`GET /api/products returned ${productsRes.status}`);
  }
  const products: Product[] = await productsRes.json();

  // Step 2: the nested resource, once per product -- its price history,
  // narrowed by the same `since` window for every card so the numbers on
  // screen all describe the same slice of time.
  return Promise.all(
    products.map(async (p) => {
      const res = await fetch(`/api/products/${p.id}/history?since=${range}`);
      if (!res.ok) {
        throw new Error(
          `GET /api/products/${p.id}/history returned ${res.status}`
        );
      }
      return (await res.json()) as History;
    })
  );
}

export function Dashboard() {
  const [histories, setHistories] = useState<History[] | null>(null);
  const [since, setSince] = useState<string>("30d");
  const [isRefetching, setIsRefetching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // If you click "7 days" then "90 days" quickly, the first response may
    // still arrive second. The cleanup function marks this run as abandoned so
    // a stale response can't overwrite a newer one.
    let cancelled = false;

    fetchDashboardData(since)
      .then((results) => {
        if (cancelled) return;
        setHistories(results);
        setError(null);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setIsRefetching(false);
      });

    return () => {
      cancelled = true;
    };
  }, [since]);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>RAM Price Tracker</h1>
        <p className={styles.subtitle}>
          Lowest listed price per kit on Rakuten Ichiba, recorded once a day.
        </p>
      </header>

      {/* One filter row, above everything it scopes -- never inside a card.
          Changing it re-renders every chart against the same window. */}
      <div className={styles.filters} role="group" aria-label="Time range">
        {RANGES.map((r) => (
          <button
            key={r.value}
            type="button"
            onClick={() => {
              if (r.value === since) return;
              // Flag the refetch here, at the event, rather than inside the
              // effect -- setting state synchronously in an effect body
              // triggers cascading renders.
              setIsRefetching(true);
              setSince(r.value);
            }}
            aria-pressed={since === r.value}
            className={`${styles.rangeButton} ${
              since === r.value ? styles.rangeButtonActive : ""
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      {error && <p className={styles.error}>Could not load data: {error}</p>}

      {histories === null && !error && <p className={styles.muted}>Loading…</p>}

      {histories?.length === 0 && (
        <p className={styles.muted}>
          No products tracked yet. Add one with{" "}
          <code>POST /api/products</code>.
        </p>
      )}

      {/* While refetching we hold the previous render at reduced opacity --
          no skeleton flash, no layout jump. */}
      <div
        className={styles.grid}
        style={{ opacity: isRefetching ? 0.5 : 1 }}
      >
        {histories?.map((h) => (
          <ProductCard key={h.product.id} history={h} />
        ))}
      </div>
    </main>
  );
}

function ProductCard({ history }: { history: History }) {
  const { product, snapshots } = history;

  // Snapshots arrive oldest-first (the API sorts ascending for charting), so
  // the current price is the last one.
  const latest = snapshots.at(-1);
  const first = snapshots.at(0);
  const change = latest && first ? latest.price - first.price : 0;

  return (
    <article className={styles.card}>
      <h2 className={styles.cardTitle}>{product.label}</h2>

      {latest ? (
        <>
          <div className={styles.priceRow}>
            {/* Stat-tile value: proportional figures, not tabular -- equal-width
                digits make a large standalone number look loose. */}
            <span className={styles.price}>{yen.format(latest.price)}</span>

            {change !== 0 && (
              <span className={styles.change}>
                {/* Colour rides the arrow glyph, and the words say the same
                    thing -- direction is never carried by colour alone. */}
                <span
                  aria-hidden
                  style={{
                    color: change < 0 ? "var(--dir-down)" : "var(--dir-up)",
                  }}
                >
                  {change < 0 ? "▼" : "▲"}
                </span>{" "}
                {yen.format(Math.abs(change))}{" "}
                {change < 0 ? "cheaper" : "dearer"} over {history.since}
              </span>
            )}
          </div>

          <p className={styles.shop}>
            at{" "}
            <a
              href={latest.item_url}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.link}
            >
              {latest.shop_name}
            </a>
          </p>

          <PriceChart snapshots={snapshots} />

          {/* The table view. A tooltip must never be the only way to read a
              value -- this is the keyboard- and screen-reader-friendly twin of
              the chart above, and it also just answers "what were the exact
              numbers?" */}
          <details className={styles.details}>
            <summary className={styles.summary}>
              View data ({history.count}{" "}
              {history.count === 1 ? "snapshot" : "snapshots"})
            </summary>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Recorded</th>
                  <th scope="col">Price</th>
                  <th scope="col">Shop</th>
                </tr>
              </thead>
              <tbody>
                {[...snapshots].reverse().map((s) => (
                  <tr key={s.id}>
                    <td>{dateTime.format(new Date(s.fetched_at))}</td>
                    <td className={styles.num}>{yen.format(s.price)}</td>
                    <td>{s.shop_name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      ) : (
        <p className={styles.muted}>
          No prices recorded in the last {history.since}.
        </p>
      )}
    </article>
  );
}
