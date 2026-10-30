"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Layout } from "@/lib/comfy/edit";
import type { ApiGraph } from "@/lib/comfy/graph";

/** What graph mode edits: the API graph and where each node sits. */
export interface Doc {
  graph: ApiGraph;
  layout: Layout;
}

const LIMIT = 100;
/** Edits with the same key this close together (typing in a field) undo as one step. */
const MERGE_MS = 700;

/** The graph being edited, with undo and redo. */
export function useGraphDoc() {
  const [doc, setDoc] = useState<Doc | null>(null);
  const docRef = useRef(doc);
  useEffect(() => {
    docRef.current = doc;
  });
  const hist = useRef<{ past: Doc[]; future: Doc[]; last: number; key: string }>({ past: [], future: [], last: 0, key: "" });
  // How deep undo and redo go, mirrored into state for the toolbar.
  const [depth, setDepth] = useState({ past: 0, future: 0 });
  const sync = () => setDepth({ past: hist.current.past.length, future: hist.current.future.length });

  /** Change the document as one undo step (edits with the same key close together merge). */
  const apply = useCallback((fn: (d: Doc) => Doc, key = "") => {
    const cur = docRef.current;
    if (!cur) return;
    const next = fn(cur);
    if (next === cur) return;
    const h = hist.current;
    const now = performance.now();
    if (!(key && key === h.key && now - h.last < MERGE_MS)) h.past = [...h.past, cur].slice(-LIMIT);
    h.future = [];
    h.last = now;
    h.key = key;
    setDoc(next);
    sync();
  }, []);

  /** A change already shown live (a drag): record the document from before it as one step. */
  const record = (before: Doc) => {
    const h = hist.current;
    h.past = [...h.past, before].slice(-LIMIT);
    h.future = [];
    h.key = "";
    sync();
  };

  const undo = () => {
    const h = hist.current;
    const cur = docRef.current;
    if (!h.past.length || !cur) return;
    h.future = [cur, ...h.future];
    setDoc(h.past[h.past.length - 1]);
    h.past = h.past.slice(0, -1);
    h.key = "";
    sync();
  };

  const redo = () => {
    const h = hist.current;
    const cur = docRef.current;
    if (!h.future.length || !cur) return;
    h.past = [...h.past, cur];
    setDoc(h.future[0]);
    h.future = h.future.slice(1);
    h.key = "";
    sync();
  };

  /** Start over on a freshly loaded document, with no history. */
  const reset = (d: Doc) => {
    hist.current = { past: [], future: [], last: 0, key: "" };
    setDepth({ past: 0, future: 0 });
    setDoc(d);
  };

  return { doc, setDoc, docRef, apply, record, undo, redo, reset, canUndo: depth.past > 0, canRedo: depth.future > 0 };
}
