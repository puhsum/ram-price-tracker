// ---------------------------------------------------------------------------
// CONSUMING an external REST API (Rakuten Ichiba Item Search).
//
// This is one half of the REST lesson. Here we are the *client*: we build a
// URL, send a GET, and deal with whatever comes back -- including the fact
// that it might not be what the docs promised. The other half (being the
// *server*) lives in src/app/api/.
//
// This module is server-only. It must never be imported into a client
// component: the credentials below would end up in the browser bundle, and
// since Rakuten authenticates via query params, anyone could read them
// straight out of the network tab.
// ---------------------------------------------------------------------------

import { z } from "zod";

// The API version is part of the URL PATH, not a header or a param. Rakuten
// date-versions its endpoints so old integrations keep working when the shape
// of the response changes -- a common REST versioning strategy.
//
// Verified against https://webservice.rakuten.co.jp/documentation/ichiba-item-search
// on 2026-09-06: version 2026-07-01, on the openapi.rakuten.co.jp host.
// Rakuten moved off app.rakuten.co.jp and began requiring accessKey in a 2026
// security change, so don't assume an older snippet from the web still works.
const RAKUTEN_SEARCH_ENDPOINT =
  "https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701";

// What we actually care about from a very large response object. Zod here is
// doing the same job it does for incoming request bodies in our own API:
// data crossing a trust boundary gets validated before we act on it. An
// external API can change shape, return nulls, or fail partially -- better to
// find out here, with a clear error, than to write NaN into the database.
//
// Note the capitalization: the live response uses `Items` -> `Item`, NOT the
// lowercase `items` -> `item` that some docs show (that's `formatVersion=2`).
// We confirmed this by loading the URL in a browser before writing any code.
// Zod ignores extra keys by default, so all the fields we don't use are fine.
const RakutenItemSchema = z.object({
  itemName: z.string(),
  itemPrice: z.number().int(),
  shopName: z.string(),
  itemUrl: z.string(),
  // The highest price on the listing page. On a normal single-SKU listing this
  // equals itemPrice; on a multi-variant page it's much larger. That gap is
  // what lets us detect variant listings -- see isVariantListing below.
  // Optional because not every response includes it.
  itemPriceMax1: z.number().int().optional(),
});

const RakutenSearchResponseSchema = z.object({
  Items: z.array(z.object({ Item: RakutenItemSchema })),
});

/** One Rakuten listing, flattened into just the fields we store. */
export type RakutenHit = {
  itemName: string;
  price: number;
  shopName: string;
  itemUrl: string;
};

/**
 * Rakuten appends `?rafcid=wsc_i_is_<our applicationId>` to every itemUrl it
 * returns. We render these links on a public page, so strip the tracking param
 * rather than broadcasting our app ID to every visitor.
 */
function stripTrackingParams(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    url.searchParams.delete("rafcid");
    return url.toString();
  } catch {
    // If Rakuten ever hands us something that isn't a valid URL, keep the
    // original string rather than throwing away an otherwise-good price.
    return rawUrl;
  }
}

/**
 * Is this a multi-variant listing -- one page selling 8/16/32/64GB of the same
 * stick, where `itemPrice` is the CHEAPEST variant rather than the capacity we
 * searched for?
 *
 * A real example: searching the exact model number "CT2K16G56C46U5" (a 32GB
 * kit) returns a page priced from JPY 37,010 up to JPY 200,560. Recording
 * 37,010 as "the price of a 32GB kit" would be plain wrong -- that's an 8GB
 * stick on the same page. Genuine single-SKU listings for that kit start
 * around JPY 92,000.
 *
 * The signal is the spread between the page's cheapest and dearest variant.
 * A normal listing has little or none; a variant page has a lot. 1.5x is a
 * deliberately loose threshold: it ignores ordinary within-listing variation
 * (colour, a bundled cable) while catching capacity ladders, which always
 * differ by 2x or more.
 */
function isVariantListing(item: z.infer<typeof RakutenItemSchema>): boolean {
  if (!item.itemPriceMax1) return false;
  return item.itemPriceMax1 > item.itemPrice * 1.5;
}

/**
 * Search Rakuten Ichiba for a keyword and return the cheapest *relevant*
 * listing, or null if there wasn't one.
 *
 * "Relevant" is doing real work here: we walk the results cheapest-first and
 * skip variant listings (see above), because a wrong price is worse than no
 * price. A gap in the chart is honest; a plausible-looking wrong number is
 * not, and once it's in the database it silently distorts the history forever.
 */
export async function fetchCheapestItem(
  keyword: string
): Promise<RakutenHit | null> {
  const appId = process.env.RAKUTEN_APP_ID;
  const accessKey = process.env.RAKUTEN_ACCESS_KEY;

  if (!appId || !accessKey) {
    throw new Error(
      "RAKUTEN_APP_ID and RAKUTEN_ACCESS_KEY must both be set (check .env.local)"
    );
  }

  // URLSearchParams handles percent-encoding for us. That matters most for
  // `sort`: the real value is "+itemPrice", but a raw "+" in a query string
  // means "space", so it has to travel as "%2BitemPrice". Hand-building this
  // string is how people accidentally turn "+itemPrice" into " itemPrice"
  // and silently lose their sort order.
  const params = new URLSearchParams({
    applicationId: appId,
    accessKey: accessKey,
    keyword,
    sort: "+itemPrice", // ascending price -> cheapest first
    hits: "5", // we only need the top few; don't make Rakuten send 30
    format: "json",
  });

  const response = await fetch(`${RAKUTEN_SEARCH_ENDPOINT}?${params}`);

  // A 200 is not guaranteed just because the network call completed. `fetch`
  // only rejects on network failure -- a 429 or 503 arrives as a perfectly
  // "successful" promise, so the status must be checked explicitly. This is
  // the single most common mistake when consuming a REST API.
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Rakuten API returned ${response.status} ${response.statusText}: ${body.slice(0, 200)}`
    );
  }

  const parsed = RakutenSearchResponseSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error(
      `Rakuten response did not match the expected shape: ${parsed.error.issues[0]?.message}`
    );
  }

  // We asked Rakuten to sort by ascending price, so the results are already
  // cheapest-first -- take the first one that isn't a variant listing.
  //
  // Zero usable results is a normal outcome (a bad keyword, nothing in stock,
  // or every hit being a variant page), not an error. The caller decides what
  // to do about it.
  const match = parsed.data.Items.map((entry) => entry.Item).find(
    (item) => !isVariantListing(item)
  );
  if (!match) return null;

  return {
    itemName: match.itemName,
    price: match.itemPrice,
    shopName: match.shopName,
    itemUrl: stripTrackingParams(match.itemUrl),
  };
}
