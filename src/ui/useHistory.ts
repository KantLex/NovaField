"use client";

import { useState } from "react";

/**
 * Undo and redo over a value the caller owns and saves itself: `commit` records the value it
 * replaces, and undo/redo hand an earlier or later one back to `apply`. When `scope` changes (another
 * project's edit, say) the history starts over, so an undo never writes one thing's past into another.
 */
export function useHistory<T>(current: T, apply: (value: T) => void, limit = 100, scope?: string) {
  const [h, setH] = useState<{ past: T[]; future: T[]; scope?: string }>({ past: [], future: [], scope });
  if (h.scope !== scope) setH({ past: [], future: [], scope });
  return {
    commit(next: T) {
      setH((x) => ({ past: [...x.past, current].slice(-limit), future: [], scope }));
      apply(next);
    },
    undo() {
      const prev = h.past.at(-1);
      if (prev === undefined) return false;
      setH({ past: h.past.slice(0, -1), future: [current, ...h.future], scope });
      apply(prev);
      return true;
    },
    redo() {
      const [next, ...rest] = h.future;
      if (next === undefined) return false;
      setH({ past: [...h.past, current], future: rest, scope });
      apply(next);
      return true;
    },
    canUndo: h.past.length > 0,
    canRedo: h.future.length > 0,
  };
}
