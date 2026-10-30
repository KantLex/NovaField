"use client";

import { useCallback, useLayoutEffect, useRef } from "react";

/**
 * A callback that keeps one identity for the component's life but always runs the latest code.
 * Lets long lists pass handlers to memoised items without re-rendering every item on each change.
 */
export function useEvent<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn);
  useLayoutEffect(() => {
    ref.current = fn;
  });
  return useCallback((...args: A) => ref.current(...args), []);
}
