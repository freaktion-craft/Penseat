"use client";

import { lazy, Suspense, useEffect, useState } from "react";

// Penseat is a devtool — it steps out of production builds.
//
// The env references are inlined at build time by the bundler, so in a
// production build (unless NEXT_PUBLIC_PENSEAT=1 was set when building)
// the condition is false: the impl chunk (and html2canvas-pro) is never
// loaded, and <Penseat /> renders nothing.
//
// The `typeof process` guard keeps non-Next bundlers (e.g. Vite) from
// crashing in the browser, where `process` may not exist at runtime.
const PenseatImpl =
  process.env.NODE_ENV === "development" ||
  (typeof process !== "undefined" &&
    process.env.NEXT_PUBLIC_PENSEAT === "1")
    ? lazy(() => import("./penseat-impl"))
    : null;

export default function Penseat() {
  // Client-only mount — a devtool gains nothing from SSR, and skipping
  // the streamed Suspense segment avoids framework reveal-script quirks
  // that can leave the overlay stuck hidden.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!PenseatImpl || !mounted) return null;
  return (
    <Suspense fallback={null}>
      <PenseatImpl />
    </Suspense>
  );
}
