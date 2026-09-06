"use client";

// The price-history chart for a single product.
//
// Recharts renders to SVG in the browser, so this has to be a Client
// Component -- "use client" is what marks that boundary in the App Router.
// Colours come from CSS tokens (see globals.css), not props, so the chart
// follows light/dark mode without any JavaScript.

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Snapshot } from "./types";

const yen = new Intl.NumberFormat("ja-JP", {
  style: "currency",
  currency: "JPY",
  maximumFractionDigits: 0,
});

const shortDate = new Intl.DateTimeFormat("en-GB", {
  month: "short",
  day: "numeric",
});

const timeOnly = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
});

// Below this span, every tick would print the same calendar day and the axis
// would read "6 Sept, 6 Sept, 6 Sept" -- so switch to clock times instead.
const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;

const dateTime = new Intl.DateTimeFormat("en-GB", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

type TooltipPayload = {
  active?: boolean;
  payload?: Array<{ payload: { t: number; price: number } }>;
};

/**
 * Custom tooltip. Values lead, labels follow: the reader already knows which
 * product they're looking at, so the price is the strong element and the
 * timestamp is secondary.
 */
function PriceTooltip({ active, payload }: TooltipPayload) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;

  return (
    <div
      style={{
        background: "var(--surface-1)",
        border: "1px solid var(--border)",
        borderRadius: 6,
        padding: "8px 10px",
        boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 15,
          fontWeight: 600,
          color: "var(--text-primary)",
        }}
      >
        {/* A short stroke of the series colour keys the row, rather than
            colouring the text itself. */}
        <span
          aria-hidden
          style={{
            width: 12,
            height: 2,
            background: "var(--series-1)",
            borderRadius: 1,
          }}
        />
        {yen.format(point.price)}
      </div>
      <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
        {dateTime.format(new Date(point.t))}
      </div>
    </div>
  );
}

export function PriceChart({ snapshots }: { snapshots: Snapshot[] }) {
  // Recharts wants plain numbers for a time axis, so timestamps become epoch
  // milliseconds and get formatted back into dates at render time.
  const data = snapshots.map((s) => ({
    t: new Date(s.fetched_at).getTime(),
    price: s.price,
  }));

  // A brand-new product only has today's snapshots, so date-only ticks would
  // repeat. Pick the tick format from how much time the data actually covers.
  const span = data.length > 1 ? data[data.length - 1].t - data[0].t : 0;
  const formatTick = (t: number) =>
    span < TWO_DAYS_MS
      ? timeOnly.format(new Date(t))
      : shortDate.format(new Date(t));

  return (
    // The container height includes room for the x-axis labels -- sizing it to
    // the plot alone is what gives a card its own tiny scrollbar.
    <div className="chart" style={{ width: "100%", height: 180 }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
          {/* Horizontal rules only; vertical ones would compete with the
              crosshair for the same job. */}
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={["dataMin", "dataMax"]}
            tickFormatter={formatTick}
            tickLine={false}
            fontSize={11}
            minTickGap={24}
          />
          <YAxis
            // Prices move in a narrow band, so a zero baseline would flatten
            // every real change into a straight line. `dataMin/dataMax` with
            // padding keeps the movement readable -- fine for a line chart
            // (a *bar* chart must always start at zero, since bar length is
            // the encoding).
            domain={["dataMin - 500", "dataMax + 500"]}
            tickFormatter={(v: number) => v.toLocaleString("en-US")}
            tickLine={false}
            axisLine={false}
            width={56}
            fontSize={11}
          />
          <Tooltip
            content={<PriceTooltip />}
            cursor={{ strokeWidth: 1 }}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="price"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            // 8px markers (r=4) with the surface ring applied via CSS.
            dot={{ r: 4 }}
            activeDot={{ r: 5 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
