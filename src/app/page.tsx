// The one page of the app.
//
// This file is a Server Component (the App Router default) and does almost
// nothing: it just renders <Dashboard />, which is a Client Component because
// it needs browser APIs -- fetch-on-mount, useState, and Recharts' SVG
// rendering. Keeping the boundary explicit like this is the normal App Router
// shape: server by default, "use client" only where the browser is required.

import { Dashboard } from "./dashboard";

export default function Home() {
  return <Dashboard />;
}
