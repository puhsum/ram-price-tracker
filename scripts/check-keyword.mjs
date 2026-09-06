// Try a search keyword against Rakuten and print what comes back, WITHOUT
// writing anything to the database. Use this before adding a product, so you
// know the keyword actually matches the kit you mean.
//
// Why this matters: Rakuten "variant" listings sell 8/16/32/64GB on one page,
// and `itemPrice` is the CHEAPEST variant on that page. A loose keyword like
// "DDR5 32GB 5600" can therefore report an 8GB stick's price under a 32GB
// label. A precise model number avoids the whole problem.
//
// Usage:
//   node --env-file=.env.local scripts/check-keyword.mjs "CT2K16G56C46U5"

const endpoint =
  "https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701";

const keyword = process.argv[2];
if (!keyword) {
  console.error('Usage: node --env-file=.env.local scripts/check-keyword.mjs "<keyword>"');
  process.exit(1);
}

const params = new URLSearchParams({
  applicationId: process.env.RAKUTEN_APP_ID,
  accessKey: process.env.RAKUTEN_ACCESS_KEY,
  keyword,
  sort: "+itemPrice",
  hits: "5",
  format: "json",
});

const res = await fetch(`${endpoint}?${params}`);
if (!res.ok) {
  console.error(`Rakuten returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
  process.exit(1);
}

const data = await res.json();
console.log(`\nkeyword: "${keyword}"  --  ${data.count} total matches\n`);

if (!data.Items?.length) {
  console.log("  (no results -- this keyword would record nothing)");
} else {
  for (const [i, { Item: item }] of data.Items.entries()) {
    // A wide gap between itemPrice and itemPriceMax1 is the tell-tale sign of
    // a multi-variant listing: the price we'd record is the cheapest variant,
    // which may not be the capacity you searched for.
    const variantWarning =
      item.itemPriceMax1 && item.itemPriceMax1 > item.itemPrice * 1.5
        ? `  <-- VARIANT LISTING (page ranges to JPY ${item.itemPriceMax1.toLocaleString()})`
        : "";

    console.log(
      `${i === 0 ? "*" : " "} JPY ${String(item.itemPrice).padStart(7)}  [${item.shopName}]${variantWarning}`
    );
    console.log(`    ${item.itemName.slice(0, 110)}`);
  }
  console.log("\n  (* = the hit that would be recorded)\n");
}
