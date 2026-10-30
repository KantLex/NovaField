"use client";

import clsx from "clsx";
import { FileDown, FileUp } from "lucide-react";
import { useRef, useState } from "react";
import { layerLabel, MOVES } from "@/lib/cinema/moves";
import { shotPath } from "@/lib/cinema/custom";
import { exportRig, parseRigFile } from "@/lib/cinema/rigFile";
import { planH3 } from "@/lib/engines/sizing";
import { toast } from "../api";
import { useStudio } from "../state";
import { recordRig } from "./rigHistory";
import { tr } from "@/i18n";

const clampSeconds = (s: number) => Math.min(15, Math.max(2, Math.round(s * 2) / 2));

/**
 * Camera moves as files (NovaField's camera-path JSON): import one, from another tool or another
 * NovaField, as an editable custom move, or export the current move to share or edit by hand.
 */
export function RigFileButtons() {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const patch = useStudio((s) => s.patch);
  const saveMove = useStudio((s) => s.saveMove);

  const load = async (file: File | undefined) => {
    if (!file) return;
    const parsed = parseRigFile(await file.text());
    if ("error" in parsed) return toast(parsed.error, "error");
    const name = parsed.name ?? file.name.replace(/\.json$/i, "").replace(/\.novafield$/i, "");
    recordRig();
    saveMove(name, parsed.rig);
    // The shot uses the saved move itself, so its tile shows as chosen and it keeps its name.
    const rig = useStudio.getState().savedMoves[0].rig;
    patch({
      rig,
      combo: null,
      previs: null,
      ...(parsed.shake !== undefined ? { shake: parsed.shake } : {}),
      ...(parsed.seconds ? { duration: clampSeconds(parsed.seconds) } : {}),
    });
    toast(tr("Imported “{name}”. It's in Saved moves; shape it in the monitor's Plan view.", { name }), "done");
  };

  const save = () => {
    const s = useStudio.getState().shot;
    const plan = planH3(s.aspect, s.quality, s.duration);
    const path = shotPath({ move: s.move, combo: s.combo, size: s.size, angle: s.angle, lens: s.lens, intensity: s.intensity, rig: s.rig, timing: s.timing, shake: s.shake, frames: plan.frames, fps: 24 });
    const name = s.rig ? (s.rig.name ?? tr("Custom move")) : s.combo?.length ? layerLabel(s.combo, tr) : tr(MOVES.find((m) => m.id === s.move)?.label ?? "Move");
    const url = URL.createObjectURL(new Blob([exportRig(path, name)], { type: "application/json" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `${name.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").toLowerCase() || "camera-move"}.json` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
      <span className="mr-1 text-dim">{tr("Camera path file")}</span>
      <button
        onClick={() => input.current?.click()}
        onDragOver={(e) => (e.preventDefault(), setOver(true))}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void load(e.dataTransfer.files[0]);
        }}
        className={clsx("flex items-center gap-1 rounded-md px-2 py-1 transition-colors", over ? "bg-tungsten/20 text-ink ring-1 ring-tungsten" : "bg-surround text-dim hover:text-ink")}
        title={tr("A NovaField camera path (.json): from another NovaField, a script or the Blender exporter. Drop it here or click.")}
      >
        <FileUp size={12} /> {tr("Import .json")}
      </button>
      <button onClick={save} className="flex items-center gap-1 rounded-md bg-surround px-2 py-1 text-dim hover:text-ink" title={tr("Save this move as a camera path file, to share or edit by hand")}>
        <FileDown size={12} /> {tr("Export .json")}
      </button>
      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(e) => {
          void load(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </div>
  );
}
