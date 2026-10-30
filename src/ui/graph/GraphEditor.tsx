"use client";

import { LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addNode, autoLayout, connect, disconnect, duplicate, HEAD_H, NODE_W, nodeHeight, reachable, removeNodes, rowsOf, setTitle, setValue, type Layout, type Pos } from "@/lib/comfy/edit";
import { isLink, type ApiGraph, type InputValue, type Link } from "@/lib/comfy/graph";
import { errorsOf, validateGraph } from "@/lib/comfy/validate";
import type { Field, RecipeSummary } from "@/lib/workflows/types";
import { fail, request, toast } from "../api";
import { useUnsaved } from "../unsaved";
import { useGraphDoc, type Doc } from "./doc";
import { GraphInspector } from "./GraphInspector";
import { GraphToolbar } from "./GraphToolbar";
import { typeColor, useObjectInfo } from "./info";
import { NodeCard, type NodeCardProps, type Wiring } from "./NodeCard";
import { Palette, type Need, type PaletteEntry } from "./Palette";
import { useGraphPointer } from "./pointer";
import { useViewport } from "./viewport";
import { curve, outPos, wiresOf, type Rows } from "./wires";
import { tr } from "@/i18n";

const mod = (e: { metaKey: boolean; ctrlKey: boolean }) => e.metaKey || e.ctrlKey;

/**
 * Graph mode: the workflow as nodes and wires. Edit values in place, rewire, add and remove
 * nodes; the server's node list checks every change as you go. Saving makes the edited graph the
 * workflow, and its form is read again from it.
 */
export function GraphEditor({ recipeId, fields, onSaved, onDirty }: { recipeId: string; fields: Field[]; onSaved: (r: RecipeSummary) => void; onDirty?: (dirty: boolean) => void }) {
  const { info, error: infoError } = useObjectInfo();
  const { doc, setDoc, docRef, apply, record, undo, redo, reset, canUndo, canRedo } = useGraphDoc();
  const [loadError, setLoadError] = useState<string | null>(null);
  const [baseline, setBaseline] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [selLink, setSelLink] = useState<{ node: string; input: string } | null>(null);
  const [palette, setPalette] = useState<{ screen: { x: number; y: number }; world: Pos; need?: Need; link?: { from?: Link; to?: { node: string; input: string } } } | null>(null);
  const [inspector, setInspector] = useState(true);
  const [focusText, setFocusText] = useState<{ node: string; input: string } | null>(null);
  const [flash, setFlash] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const canvas = useRef<HTMLDivElement>(null);
  const selRef = useRef(sel);
  useEffect(() => {
    selRef.current = sel;
  });

  // Load the graph, with saved positions or a fresh layout for nodes that have none.
  useEffect(() => {
    if (!info) return;
    let live = true;
    request<{ graph: ApiGraph; layout: Layout | null }>(`/api/workflows/${recipeId}/graph`)
      .then(({ graph, layout }) => {
        if (!live) return;
        const auto = autoLayout(graph, info);
        const merged = Object.fromEntries(Object.keys(graph).map((id) => [id, layout?.[id] ?? auto[id]]));
        const d = { graph, layout: merged };
        setBaseline(JSON.stringify(d));
        reset(d);
      })
      .catch((e: Error) => live && setLoadError(e.message));
    return () => {
      live = false;
    };
    // reset is a fresh function each render; loading again only matters when the workflow or node list changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipeId, info]);

  const dirty = useMemo(() => !!doc && JSON.stringify(doc) !== baseline, [doc, baseline]);
  useEffect(() => onDirty?.(dirty), [dirty, onDirty]);
  useUnsaved(dirty);

  // Derived: rows per node, what runs, problems, which inputs are on the form.
  const rows: Rows = useMemo(() => (doc && info ? new Map(Object.entries(doc.graph).map(([id, n]) => [id, rowsOf(n.class_type, n.inputs, info)])) : new Map()), [doc, info]);
  const runs = useMemo(() => (doc && info ? reachable(doc.graph, info) : new Set<string>()), [doc, info]);
  const issues = useMemo(() => (doc && info ? validateGraph(doc.graph, info) : []), [doc, info]);
  const errors = errorsOf(issues);
  const errorsByNode = useMemo(() => {
    const m: Record<string, number> = {};
    for (const i of errorsOf(issues)) m[i.node] = (m[i.node] ?? 0) + 1;
    return m;
  }, [issues]);
  const formByNode = useMemo(() => {
    const m: Record<string, Record<string, string>> = {};
    for (const f of fields) if (f.exposed) (m[f.node] ??= {})[f.input] = f.label;
    return m;
  }, [fields]);
  const noForm = useMemo(() => ({}), []);

  const heightOf = useCallback(
    (id: string) => {
      const r = rows.get(id);
      return r ? nodeHeight(r.outputs.length, r.inputs.length) : 80;
    },
    [rows],
  );
  const { view, setView, touched: viewTouched, toWorld, fit, zoomBy } = useViewport(canvas, docRef, heightOf, !!doc);

  const openPalette = (cx: number, cy: number, need?: Need, link?: { from?: Link; to?: { node: string; input: string } }) => {
    const r = canvas.current!.getBoundingClientRect();
    const x = Math.min(cx - r.left, r.width - 350);
    const y = Math.min(cy - r.top, r.height - 380);
    setPalette({ screen: { x: Math.max(8, x), y: Math.max(8, y) }, world: toWorld(cx, cy), need, link });
  };

  const pulse = (ids: string[]) => {
    setFlash(new Set(ids));
    setTimeout(() => setFlash(new Set()), 900);
  };

  const { wire, marquee, startDrag } = useGraphPointer({
    docRef,
    setDoc,
    record,
    apply,
    toWorld,
    setView,
    viewTouched,
    heightOf,
    onClear: () => {
      setSel(new Set());
      setSelLink(null);
      setPalette(null);
    },
    onSelect: (ids, add) => setSel((s) => new Set(add ? [...s, ...ids] : ids)),
    onWired: (node) => pulse([node]),
    onLooseWire: (cx, cy, type, from) => openPalette(cx, cy, { dir: "in", type }, { from }),
  });

  const pick = (p: PaletteEntry) => {
    const at = palette;
    setPalette(null);
    if (!at || !info) return;
    let added = "";
    apply((cur) => {
      const { graph, id } = addNode(cur.graph, p.classType, info);
      added = id;
      let g = graph;
      if (at.link?.from && p.input) g = connect(g, at.link.from, { node: id, input: p.input });
      if (at.link?.to && p.output !== undefined) g = connect(g, [id, p.output], at.link.to);
      // A source for an input lands to its left; anything else where the palette opened.
      const pos: Pos = at.link?.to ? [at.world[0] - NODE_W - 60, at.world[1] - HEAD_H] : [at.world[0], at.world[1] - HEAD_H / 2];
      return { graph: g, layout: { ...cur.layout, [id]: [Math.round(pos[0]), Math.round(pos[1])] } };
    });
    if (added) {
      setSel(new Set([added]));
      pulse([added]);
    }
  };

  // Stable handlers for the memoised node cards.
  const noop = () => {};
  const handlers = useRef<Pick<NodeCardProps, "onGrab" | "onWireFromOutput" | "onGrabInput" | "onValue" | "onEditText">>({
    onGrab: noop,
    onWireFromOutput: noop,
    onGrabInput: noop,
    onValue: noop,
    onEditText: noop,
  });
  useEffect(() => {
    handlers.current.onGrab = (id, e) => {
      e.stopPropagation();
      canvas.current?.focus();
      setSelLink(null);
      const d = docRef.current;
      if (!d) return;
      let next = new Set(selRef.current);
      if (e.shiftKey) {
        if (next.has(id)) {
          next.delete(id);
          setSel(next);
          return;
        }
        next.add(id);
      } else if (!next.has(id)) next = new Set([id]);
      setSel(next);
      startDrag({ kind: "move", start: toWorld(e.clientX, e.clientY), origins: new Map([...next].map((n) => [n, d.layout[n]])), before: d, moved: false });
    };
    handlers.current.onWireFromOutput = (id, slot, type, e) => {
      e.stopPropagation();
      startDrag({ kind: "wire", from: [id, slot], type }, toWorld(e.clientX, e.clientY));
    };
    handlers.current.onGrabInput = (id, input, e) => {
      e.stopPropagation();
      const d = docRef.current;
      if (!d || !info) return;
      const v = d.graph[id]?.inputs[input];
      if (isLink(v)) {
        // Pick the wire up from its end: re-plug it elsewhere, or let go to remove it.
        const type = rows.get(v[0])?.outputs[v[1]]?.type ?? "*";
        setDoc({ ...d, graph: disconnect(d.graph, { node: id, input }, info) });
        startDrag({ kind: "wire", from: v, type, before: d }, toWorld(e.clientX, e.clientY));
      } else {
        const type = rows.get(id)?.inputs.find((r: { name: string }) => r.name === input)?.type ?? "*";
        openPalette(e.clientX, e.clientY, { dir: "out", type }, { to: { node: id, input } });
      }
    };
    handlers.current.onValue = (id, input, v) => apply((cur) => ({ ...cur, graph: setValue(cur.graph, id, input, v) }), `v:${id}:${input}`);
    handlers.current.onEditText = (id, input) => {
      setSel(new Set([id]));
      setInspector(true);
      setFocusText({ node: id, input });
    };
  });
  const cardHandlers = useMemo(
    () => ({
      onGrab: (id: string, e: React.PointerEvent) => handlers.current.onGrab(id, e),
      onWireFromOutput: (id: string, s: number, t: string, e: React.PointerEvent) => handlers.current.onWireFromOutput(id, s, t, e),
      onGrabInput: (id: string, i: string, e: React.PointerEvent) => handlers.current.onGrabInput(id, i, e),
      onValue: (id: string, i: string, v: InputValue) => handlers.current.onValue(id, i, v),
      onEditText: (id: string, i: string) => handlers.current.onEditText(id, i),
    }),
    [],
  );

  const removeSelection = () => {
    if (selLink && info) {
      apply((cur) => ({ ...cur, graph: disconnect(cur.graph, selLink, info) }));
      setSelLink(null);
      return;
    }
    if (!sel.size) return;
    const ids = [...sel];
    apply((cur) => ({ graph: removeNodes(cur.graph, ids), layout: Object.fromEntries(Object.entries(cur.layout).filter(([id]) => !sel.has(id))) }));
    setSel(new Set());
  };
  const duplicateSelection = () => {
    if (!sel.size) return;
    let copies: string[] = [];
    apply((cur) => {
      const { graph, map } = duplicate(cur.graph, [...sel]);
      copies = Object.values(map);
      const layout = { ...cur.layout };
      for (const [from, to] of Object.entries(map)) layout[to] = [cur.layout[from][0] + 40, cur.layout[from][1] + 40];
      return { graph, layout };
    });
    setSel(new Set(copies));
    pulse(copies);
  };
  const arrange = () => {
    if (!info) return;
    apply((cur) => ({ ...cur, layout: autoLayout(cur.graph, info) }));
    requestAnimationFrame(() => fit());
  };

  const save = async () => {
    const d = docRef.current;
    if (!d) return;
    setSaving(true);
    try {
      const summary = await request<RecipeSummary>(`/api/workflows/${recipeId}/graph`, { method: "PUT", json: d });
      setBaseline(JSON.stringify(d));
      onSaved(summary);
      toast(tr("Saved. The form was read again from the graph."), "done");
    } catch (e) {
      fail(e);
    } finally {
      setSaving(false);
    }
  };
  const discard = () => {
    if (!dirty || !confirm(tr("Throw away the changes since the last save?"))) return;
    const d = JSON.parse(baseline) as Doc;
    record(docRef.current!);
    setDoc(d);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest("input, textarea, select")) return;
    const k = e.key.toLowerCase();
    const shortcuts: Record<string, () => void> = mod(e)
      ? {
          z: () => (e.shiftKey ? redo() : undo()),
          y: redo,
          s: () => void save(),
          d: duplicateSelection,
          a: () => setSel(new Set(Object.keys(doc?.graph ?? {}))),
        }
      : {
          delete: removeSelection,
          backspace: removeSelection,
          f: () => fit(sel.size ? [...sel] : undefined),
          a: () => {
            const r = canvas.current!.getBoundingClientRect();
            openPalette(r.left + r.width / 2 - 170, r.top + r.height / 3);
          },
          escape: () => {
            setSel(new Set());
            setSelLink(null);
            setPalette(null);
          },
        };
    const run = shortcuts[k === "/" ? "a" : k];
    if (!run) return;
    e.preventDefault();
    run();
  };

  if (infoError || loadError) {
    return <p className="rounded-md bg-tally/10 px-4 py-3 text-[13px] text-tally">{infoError ?? loadError}</p>;
  }
  if (!doc || !info) {
    return (
      <p className="flex items-center gap-2 py-10 text-[13px] text-dim">
        <LoaderCircle size={14} className="animate-spin" /> {tr("Reading the graph and the server's node list…")}
      </p>
    );
  }

  const one = sel.size === 1 ? [...sel][0] : null;
  const links = wiresOf(doc, rows, runs, selLink);
  const wiring: Wiring | null = wire ? { type: wire.type, from: wire.from[0] } : null;

  return (
    <div className="flex h-[calc(100dvh_-_190px)] min-h-[560px] flex-col overflow-hidden rounded-md bg-panel shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]">
      <GraphToolbar
        dirty={dirty}
        saving={saving}
        onSave={() => void save()}
        onDiscard={discard}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={undo}
        onRedo={redo}
        onAddNode={() => {
          const r = canvas.current!.getBoundingClientRect();
          openPalette(r.left + r.width / 2 - 170, r.top + 60);
        }}
        onArrange={arrange}
        onFit={() => fit()}
        zoom={view.z}
        onZoom={zoomBy}
        nodes={Object.keys(doc.graph).length}
        runs={runs.size}
        errors={errors.length}
        inspector={inspector}
        onToggleInspector={() => setInspector((x) => !x)}
      />

      <div className="flex min-h-0 flex-1">
        <div
          ref={canvas}
          data-canvas
          tabIndex={0}
          onKeyDown={onKey}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            canvas.current?.focus();
            setPalette(null);
            if (e.shiftKey) startDrag({ kind: "marquee", a: toWorld(e.clientX, e.clientY), add: true });
            else startDrag({ kind: "pan", sx: e.clientX, sy: e.clientY, x0: view.x, y0: view.y, moved: false });
          }}
          onDoubleClick={(e) => {
            if ((e.target as HTMLElement).closest("[data-node]")) return;
            openPalette(e.clientX, e.clientY);
          }}
          className="relative min-w-0 flex-1 cursor-default overflow-hidden outline-none select-none focus-visible:outline-none"
          style={{
            backgroundColor: "#090909",
            backgroundImage: "radial-gradient(circle, #262626 1px, transparent 1.2px)",
            backgroundSize: `${22 * view.z}px ${22 * view.z}px`,
            backgroundPosition: `${view.x}px ${view.y}px`,
          }}
          aria-label={tr("Graph canvas. Drag to pan, Shift-drag to select, A to add a node, Delete to remove, ⌘Z to undo.")}
        >
          <div className="absolute top-0 left-0 origin-top-left" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})` }}>
            <svg className="pointer-events-none absolute top-0 left-0 overflow-visible" width={1} height={1}>
              {links.map((l) => (
                <g key={l.key}>
                  <path d={l.d} fill="none" stroke={l.selected ? "#e4ff1a" : l.color} strokeWidth={l.selected ? 3 : 2} strokeOpacity={l.idle ? 0.3 : 0.85} vectorEffect="non-scaling-stroke" />
                  <path
                    d={l.d}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={12}
                    className="pointer-events-auto cursor-pointer"
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      canvas.current?.focus();
                      setSel(new Set());
                      setSelLink(l.to);
                    }}
                  />
                </g>
              ))}
              {wire && <path d={curve(outPos(doc, wire.from[0], wire.from[1]), wire.at)} fill="none" stroke={typeColor(wire.type)} strokeWidth={2} strokeDasharray="6 5" vectorEffect="non-scaling-stroke" />}
            </svg>
            {Object.entries(doc.graph).map(([id, node]) =>
              doc.layout[id] ? (
                <NodeCard
                  key={id}
                  id={id}
                  node={node}
                  def={info[node.class_type]}
                  pos={doc.layout[id]}
                  rows={rows.get(id)!}
                  selected={sel.has(id)}
                  idle={!runs.has(id)}
                  errors={errorsByNode[id] ?? 0}
                  formFields={formByNode[id] ?? noForm}
                  wiring={wiring}
                  flash={flash.has(id)}
                  {...cardHandlers}
                />
              ) : null,
            )}
            {marquee && (
              <div
                className="absolute border border-tungsten/70 bg-tungsten/10"
                style={{
                  left: Math.min(marquee.a[0], marquee.b[0]),
                  top: Math.min(marquee.a[1], marquee.b[1]),
                  width: Math.abs(marquee.b[0] - marquee.a[0]),
                  height: Math.abs(marquee.b[1] - marquee.a[1]),
                }}
              />
            )}
          </div>

          {palette && <Palette info={info} at={palette.screen} need={palette.need} onPick={pick} onClose={() => setPalette(null)} />}

          <p className="pointer-events-none absolute bottom-2 left-3 text-[11px] text-faint">
            {tr("Drag to pan · ⌘-scroll to zoom · Shift-drag to select · drag from an output to wire · A to add · ⌫ to delete")}
          </p>
        </div>

        {inspector && (
          <GraphInspector
            info={info}
            doc={doc}
            sel={sel}
            one={one}
            issues={issues}
            formByNode={formByNode}
            focusText={focusText}
            onFocusDone={() => setFocusText(null)}
            onValue={(id, input, v) => apply((cur) => ({ ...cur, graph: setValue(cur.graph, id, input, v) }), `v:${id}:${input}`)}
            onTitle={(id, t) => apply((cur) => ({ ...cur, graph: setTitle(cur.graph, id, t) }), `t:${id}`)}
            onDelete={removeSelection}
            onDuplicate={duplicateSelection}
            onFocusNode={(id) => {
              setSel(new Set([id]));
              fit([id]);
              pulse([id]);
            }}
          />
        )}
      </div>
    </div>
  );
}
