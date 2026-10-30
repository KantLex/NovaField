"use client";

import { useEffect, useId } from "react";
import { tr } from "@/i18n";

// Editors with changes not yet saved. Leaving them in the app (another workflow, another page, a
// new language, which re-renders the page) asks first, as closing the tab does.
const open = new Set<string>();

/** Mark this editor as holding unsaved changes while `dirty` is true. */
export function useUnsaved(dirty: boolean) {
  const id = useId();
  useEffect(() => {
    if (!dirty) return;
    open.add(id);
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => {
      open.delete(id);
      window.removeEventListener("beforeunload", warn);
    };
  }, [dirty, id]);
}

/** True when nothing is unsaved, or the person agrees to drop it. */
export const confirmDiscard = () => !open.size || confirm(tr("You have unsaved changes. Leave without saving them?"));
