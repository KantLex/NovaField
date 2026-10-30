"use client";

// Dragging takes onto a project or a slot that uses them: what's carried, a small drag preview
// instead of the whole card, and what kind of media is in flight so matching slots can light up.

import { create } from "zustand";
import { useLive } from "./state";

export const TAKES_MIME = "application/x-novafield-takes";

/** The media of the takes being dragged right now (null when nothing is), for drop targets to light up. */
export const useTakeDrag = create<{ media: ("image" | "video" | "audio")[] | null }>(() => ({ media: null }));

const endDrag = () => useTakeDrag.setState({ media: null });

export function startTakeDrag(e: React.DragEvent, ids: string[], poster?: string) {
  e.dataTransfer.setData(TAKES_MIME, JSON.stringify(ids));
  const jobs = useLive.getState().jobs;
  const media = ids.map((id) => jobs[id]).flatMap((j) => (!j || j.status !== "done" ? [] : j.video ? ["video" as const] : j.image ? ["image" as const] : j.audio ? ["audio" as const] : []));
  useTakeDrag.setState({ media: [...new Set(media)] });
  // The card may re-render away mid-drag, so listen on the window for the end.
  window.addEventListener("dragend", endDrag, { once: true, capture: true });
  window.addEventListener("drop", endDrag, { once: true, capture: true });
  // Moved onto a project, or copied into a slot that uses it.
  e.dataTransfer.effectAllowed = "copyMove";
  const ghost = document.createElement("div");
  ghost.style.cssText =
    "position:fixed;top:-200px;left:-200px;display:flex;align-items:center;gap:8px;padding:4px 10px 4px 4px;border-radius:8px;background:#1a1a1a;color:#f4f4ec;font:600 12px system-ui;box-shadow:0 0 0 1px #e4ff1a66,0 8px 24px #000a";
  if (poster) {
    const img = document.createElement("img");
    img.src = poster;
    img.style.cssText = "width:44px;height:26px;object-fit:cover;border-radius:4px";
    ghost.appendChild(img);
  }
  const label = document.createElement("span");
  label.textContent = ids.length > 1 ? `${ids.length} takes` : "1 take";
  ghost.appendChild(label);
  document.body.appendChild(ghost);
  e.dataTransfer.setDragImage(ghost, 22, 17);
  setTimeout(() => ghost.remove(), 0);
}

export const isTakeDrag = (e: React.DragEvent) => e.dataTransfer.types.includes(TAKES_MIME);

export function takesFrom(e: React.DragEvent): string[] {
  try {
    const ids = JSON.parse(e.dataTransfer.getData(TAKES_MIME));
    return Array.isArray(ids) ? ids.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}
