"use client";

import clsx from "clsx";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * A button that opens a small panel; closes on outside click, Escape, scroll or resize.
 * The panel renders at the page level so scrolling strips and cards never clip it.
 */
export function Menu({
  trigger,
  children,
  align = "left",
  className,
  label,
}: {
  trigger: (open: boolean) => React.ReactNode;
  children: (close: () => void) => React.ReactNode;
  align?: "left" | "right";
  className?: string;
  label: string;
}) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const open = !!rect;
  const ref = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const close = () => setRect(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && !panel.current?.contains(e.target as Node) && setRect(null);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setRect(null);
    const onMove = (e: Event) => !panel.current?.contains(e.target as Node) && setRect(null);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open]);
  // Keep the whole panel on screen: line it up with the button, then clamp it inside the window.
  useLayoutEffect(() => {
    const el = panel.current;
    if (!rect || !el) return;
    const w = el.offsetWidth;
    const want = align === "right" ? rect.right - w : rect.left;
    el.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, want))}px`;
    el.style.right = "auto";
  }, [rect, align]);
  // Open downward unless the button sits low on the screen.
  const up = rect ? rect.bottom > window.innerHeight * 0.6 : false;
  const style: React.CSSProperties = rect
    ? {
        position: "fixed",
        ...(up ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }),
        maxHeight: up ? rect.top - 14 : window.innerHeight - rect.bottom - 14,
        overflowY: "auto",
        ...(align === "right" ? { right: Math.max(8, window.innerWidth - rect.right) } : { left: Math.max(8, rect.left) }),
      }
    : {};

  return (
    <div ref={ref} className="relative">
      <button
        onClick={(e) => {
          e.stopPropagation();
          setRect(open ? null : e.currentTarget.getBoundingClientRect());
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        className="flex items-center"
      >
        {trigger(open)}
      </button>
      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {open && (
              <motion.div
                ref={panel}
                role="menu"
                initial={{ opacity: 0, y: up ? 4 : -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.12 }}
                onClick={(e) => e.stopPropagation()}
                style={style}
                className={clsx("z-[60] min-w-[220px] rounded-md border border-line bg-panel p-1 shadow-[0_12px_32px_rgba(0,0,0,0.6)]", className)}
              >
                {children(close)}
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </div>
  );
}

export function MenuItem({ children, onClick, active, danger }: { children: React.ReactNode; onClick: () => void; active?: boolean; danger?: boolean }) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className={clsx(
        "flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-[13px] transition-colors",
        active ? "bg-raised text-ink" : danger ? "text-tally hover:bg-raised" : "text-dim hover:bg-raised hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}
