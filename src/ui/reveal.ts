"use client";

import { useState } from "react";

/**
 * A soft, staggered fade-up for a grid whose filter just changed, so the new set arrives rather
 * than snapping in. Never on first paint. Spread the result on the grid: it remounts the items
 * (key) and staggers them with CSS (.nf-reveal in globals.css).
 */
export function useReveal(filter: unknown): { key: number; className: string } {
  const [seen, setSeen] = useState(filter);
  const [n, setN] = useState(0);
  if (!Object.is(seen, filter)) {
    setSeen(filter);
    setN(n + 1);
  }
  return { key: n, className: n ? "nf-reveal" : "" };
}
