"use client";

// The floor plan's inspector: whatever is selected (a set piece, a camera mark or its aim, a
// stand-in) as fields to type into, plus saving the move by name.

import { Bookmark, Copy, Trash2 } from "lucide-react";
import { useState } from "react";
import type { Actor, CameraKey, CameraPath, Prop, Vec3 } from "@/lib/cinema/camera";
import { ACTOR_COLORS, type CustomRig } from "@/lib/cinema/custom";
import { fovFor, LENSES } from "@/lib/cinema/moves";
import { toast } from "../api";
import { Menu } from "../Menu";
import { useStudio } from "../state";
import { keyLabel, lensOf, MAX_PROPS, PROP_RGB, type Handle } from "./planGeometry";
import { tr } from "@/i18n";

export function PlanInspector({
  sel,
  path,
  onEdit,
  onGrab,
  onRemove,
}: {
  sel: Handle | null;
  path: CameraPath;
  onEdit: (fn: (r: CustomRig) => CustomRig) => void;
  onGrab: () => void;
  onRemove: () => void;
}) {
  const box = "absolute right-3 bottom-3 flex max-w-[calc(100%-24px)] flex-wrap items-center gap-x-4 gap-y-2 rounded-md bg-black/70 px-3 py-2 text-[12px] backdrop-blur";
  if (!sel) {
    return (
      <p className="pointer-events-none absolute inset-x-3 bottom-2.5 text-center text-[12px] text-ink/60">
        {tr("Drag {a} and {b} to move the camera, crosshairs to aim, circles to place people. Drag the marks on the timeline to time the move.")
          .split(/\{(a|b)\}/)
          .map((part, i) => (i % 2 ? <b key={i} className="text-tungsten">{part.toUpperCase()}</b> : part))}
      </p>
    );
  }
  const n = path.keys.length;
  const remove = (label: string) => (
    <button onClick={onRemove} className="flex items-center gap-1 text-tally hover:underline">
      <Trash2 size={12} /> {label}
    </button>
  );

  if (sel.kind === "prop") {
    const pr = path.props?.[sel.i];
    if (!pr) return null;
    const setProp = (fn: (x: Prop) => Prop) => onEdit((r) => ({ ...r, props: (r.props ?? []).map((x, i) => (i === sel.i ? fn({ ...x }) : x)) }));
    const dim = (k: 0 | 1 | 2) => (v: number) => setProp((x) => ({ ...x, size: x.size.map((s, j) => (j === k ? v : s)) as Vec3 }));
    return (
      <div className={box}>
        <span className="font-semibold" style={{ color: `rgb(${PROP_RGB})` }}>
          {tr(pr.label ?? "Set piece")}
        </span>
        <Mini label={tr("Width")} value={pr.size[0]} min={0.2} max={8} step={0.05} unit="m" onStart={onGrab} onChange={dim(0)} />
        <Mini label={tr("Depth")} value={pr.size[2]} min={0.1} max={8} step={0.05} unit="m" onStart={onGrab} onChange={dim(2)} />
        <Mini label={tr("Height")} value={pr.size[1]} min={0.1} max={4} step={0.05} unit="m" onStart={onGrab} onChange={dim(1)} />
        <Mini label={tr("Turn")} value={pr.rot ?? 0} min={-180} max={180} step={5} unit="°" onStart={onGrab} onChange={(v) => setProp((x) => ({ ...x, rot: v }))} />
        <button
          onClick={() => {
            onGrab();
            onEdit((r) => ((r.props?.length ?? 0) >= MAX_PROPS ? r : { ...r, props: [...(r.props ?? []), { ...pr, at: [pr.at[0] + 0.6, pr.at[1] + 0.6] as [number, number] }] }));
          }}
          className="flex items-center gap-1 text-ink/80 hover:text-ink hover:underline"
        >
          <Copy size={12} /> {tr("Duplicate")}
        </button>
        {remove(tr("Remove"))}
      </div>
    );
  }

  if (sel.kind === "cam" || sel.kind === "aim") {
    const k = path.keys[sel.i];
    if (!k) return null;
    const setKey = (fn: (k: CameraKey) => CameraKey) => onEdit((r) => ({ ...r, keys: r.keys.map((x, i) => (i === sel.i ? fn({ ...x }) : x)) }));
    return (
      <div className={box}>
        <span className="font-semibold text-tungsten">{sel.kind === "cam" ? `Camera ${keyLabel(sel.i, n)}` : `Aim ${keyLabel(sel.i, n)}`}</span>
        <Mini
          label={tr("Height")}
          value={sel.kind === "cam" ? k.pos[1] : k.target[1]}
          min={sel.kind === "cam" ? 0.1 : 0}
          max={sel.kind === "cam" ? 9 : 4}
          step={0.05}
          unit="m"
          onStart={onGrab}
          onChange={(v) => setKey((x) => (sel.kind === "cam" ? { ...x, pos: [x.pos[0], v, x.pos[2]] } : { ...x, target: [x.target[0], v, x.target[2]] }))}
        />
        {sel.kind === "cam" && (
          <>
            <label className="flex items-center gap-1.5">
              <span className="text-ink/60">{tr("Lens")}</span>
              <select
                value={lensOf(k.fov)}
                onChange={(e) => {
                  onGrab();
                  setKey((x) => ({ ...x, fov: fovFor(Number(e.target.value)) }));
                }}
                className="readout rounded bg-white/10 px-1 py-0.5 text-[13px]"
              >
                {LENSES.map((l) => (
                  <option key={l} value={l}>
                    {l}mm
                  </option>
                ))}
              </select>
            </label>
            <Mini label={tr("Roll")} value={k.roll} min={-30} max={30} step={1} unit="°" onStart={onGrab} onChange={(v) => setKey((x) => ({ ...x, roll: v }))} />
          </>
        )}
        {sel.kind === "cam" && sel.i > 0 && sel.i < n - 1 && remove(tr("Remove point"))}
      </div>
    );
  }

  const a = path.actors?.[sel.i];
  if (!a) return null;
  const walking = a.to[0] !== a.from[0] || a.to[1] !== a.from[1];
  const following = path.follow?.actor === sel.i;
  const setActor = (fn: (x: Actor) => Actor) => onEdit((r) => ({ ...r, actors: r.actors.map((x, i) => (i === sel.i ? fn({ ...x }) : x)) }));
  const start = a.start ?? 0;
  const end = a.end ?? 1;
  return (
    <div className={box}>
      <span className="font-semibold" style={{ color: ACTOR_COLORS[sel.i % ACTOR_COLORS.length] }}>
        Stand-in {sel.i + 1}
      </span>
      <Mini label={tr("Height")} value={a.height} min={0.8} max={2.3} step={0.05} unit="m" onStart={onGrab} onChange={(v) => setActor((x) => ({ ...x, height: v }))} />
      <Check
        label={tr("Walks")}
        checked={walking}
        onChange={(on) => {
          onGrab();
          setActor((x) => ({ ...x, to: on ? [x.from[0] + 2.5, x.from[1]] : [x.from[0], x.from[1]] }));
        }}
      />
      {walking && (
        <>
          <Mini label={tr("Sets off")} value={start * 100} min={0} max={95} step={5} unit="%" onStart={onGrab} onChange={(v) => setActor((x) => ({ ...x, start: v / 100, end: Math.max(x.end ?? 1, v / 100 + 0.05) }))} />
          <Mini label={tr("Arrives")} value={end * 100} min={5} max={100} step={5} unit="%" onStart={onGrab} onChange={(v) => setActor((x) => ({ ...x, end: v / 100, start: Math.min(x.start ?? 0, v / 100 - 0.05) }))} />
        </>
      )}
      <Check
        label={tr("Camera follows")}
        checked={following}
        onChange={(on) => {
          onGrab();
          onEdit((r) => ({ ...r, follow: on ? { actor: sel.i, height: Math.round(a.height * 0.8 * 100) / 100, amount: 0.9 } : null }));
        }}
      />
      {remove(tr("Remove"))}
    </div>
  );
}

/** Keep a shaped move: it appears under Saved in the camera moves, stand-ins and set pieces included. */
export function SaveMove({ rig }: { rig: CustomRig }) {
  const saveMove = useStudio((s) => s.saveMove);
  const [name, setName] = useState("");
  return (
    <Menu
      label={tr("Save this move")}
      trigger={() => (
        <span className="flex items-center gap-1 rounded-md bg-black/60 px-2 py-1 text-[12px] text-ink/85 backdrop-blur hover:bg-black/80 hover:text-ink">
          <Bookmark size={13} /> {tr("Save")}
        </span>
      )}
    >
      {(close) => (
        <form
          className="flex flex-col gap-2 p-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            const n = name.trim() || tr("My move");
            saveMove(n, rig);
            setName("");
            close();
            toast(tr("Saved “{name}”. It's under Saved in the camera moves.", { name: n }), "done");
          }}
        >
          <label className="text-[12px] text-dim" htmlFor="save-move-name">
            {tr("Name this move")}
          </label>
          <input
            id="save-move-name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={tr("Market reveal")}
            className="rounded bg-surround px-2 py-1.5 text-[13px] focus:outline-none"
          />
          <button type="submit" className="rounded-md bg-tungsten px-3 py-1.5 text-[13px] font-semibold text-black">
            {tr("Save move")}
          </button>
        </form>
      )}
    </Menu>
  );
}

function Mini({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
  onStart,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (v: number) => void;
  /** A drag on the slider is starting (a new undo step). */
  onStart?: () => void;
}) {
  return (
    <label className="flex items-center gap-1.5">
      <span className="text-ink/60">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onPointerDown={onStart}
        onKeyDown={onStart}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 w-24"
      />
      <span className="readout w-10 text-[13px]">
        {Math.round(value * 100) / 100}
        {unit}
      </span>
    </label>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-1.5">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-tungsten" />
      {label}
    </label>
  );
}

