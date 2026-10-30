"use client";

import { useEffect } from "react";
import { useEvent } from "./useEvent";

/** True when a key press belongs to a text field rather than to a page shortcut. */
export const isTyping = (target: EventTarget | null) => !!(target as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable]:not([contenteditable='false'])");

/** True while a modal (a sheet, the inspector) is open and the key press isn't inside it. */
const behindModal = (target: EventTarget | null) => {
  const modals = document.querySelectorAll("[aria-modal='true'], [aria-modal='']");
  if (!modals.length) return false;
  const el = target as Node | null;
  return ![...modals].some((m) => el && m.contains(el));
};

/**
 * Page shortcuts, as in an editing app: `handler` sees key presses outside text fields, and none
 * while a modal is open over the page. When the handler takes Space (preventDefault) on a focused
 * button, the button lets go of focus so it doesn't act again on keyup (play twice). A Space the
 * page doesn't use still presses the button.
 */
export function useHotkeys(handler: (e: KeyboardEvent) => void) {
  const run = useEvent(handler);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || behindModal(e.target)) return;
      run(e);
      const el = e.target as HTMLElement | null;
      if (e.key === " " && e.defaultPrevented && el?.closest?.("button")) el.blur();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [run]);
}
