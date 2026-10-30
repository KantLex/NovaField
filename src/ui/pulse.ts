"use client";

import { useEffect, useRef } from "react";

/**
 * Replays a CSS animation class on an element whenever `value` changes (never on first paint).
 * CSS keeps it robust: a throttled background tab can't leave half-finished inline styles behind.
 */
export function usePulse<T extends HTMLElement>(value: unknown, className: string) {
  const ref = useRef<T>(null);
  const prev = useRef(value);
  useEffect(() => {
    const el = ref.current;
    if (Object.is(prev.current, value) || !el) return;
    prev.current = value;
    el.classList.remove(className);
    void el.offsetWidth;
    el.classList.add(className);
  }, [value, className]);
  return ref;
}
