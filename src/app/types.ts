// Shapes returned by our own REST API. These mirror what the route handlers
// in src/app/api/ actually send, so the frontend and backend agree on one
// contract -- change a route's response and TypeScript will point at every
// component that read the old shape.

export type Product = {
  id: number;
  label: string;
  search_keyword: string;
  created_at: string;
};

export type Snapshot = {
  id: number;
  price: number;
  shop_name: string;
  item_url: string;
  fetched_at: string;
};

/** Response body of GET /api/products/:id/history */
export type History = {
  product: Pick<Product, "id" | "label" | "search_keyword">;
  since: string;
  count: number;
  snapshots: Snapshot[];
};
