"use client";

// Settings → Models: every model behind NovaField's features, whether your ComfyUI PC has it, and
// a way to get the ones it doesn't.

import clsx from "clsx";
import { Boxes, Check, ChevronDown } from "lucide-react";
import { useState } from "react";
import { MODEL_FILES } from "@/lib/modelFiles";
import { MODEL_SETS } from "@/lib/modelSets";
import { formatBytes, GetModels, useMissing, useModels, useModelsStatus } from "./GetModels";
import { tr } from "@/i18n";

export function ModelsPanel() {
  const status = useModelsStatus();
  return (
    <section className="flex flex-col gap-3 rounded-md bg-panel p-4" aria-labelledby="models">
      <div className="flex items-start gap-3">
        <Boxes size={18} className="mt-0.5 shrink-0 text-tungsten" />
        <div className="min-w-0">
          <h2 id="models" className="text-[15px] font-semibold">
            {tr("Models")}
          </h2>
          <p className="text-[13px] text-dim">
            {status?.cloud
              ? tr("Comfy Cloud has its own models; there's nothing to download.")
              : status?.pack
                ? tr("What each feature needs on your ComfyUI PC. Missing files download straight to that PC through the NovaField nodes.")
                : tr("What each feature needs on your ComfyUI PC. Update the NovaField nodes (0.5.0 or later) to download missing files from here; until then each file has its link and folder.")}
          </p>
        </div>
      </div>
      {status && !status.cloud && (
        <ul className="flex flex-col divide-y divide-line/50">
          {MODEL_SETS.map((m) => (
            <ModelRow key={m.id} name={m.name} hint={m.hint} files={m.files} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ModelRow({ name, hint, files }: { name: string; hint: string; files: string[] }) {
  const missing = useMissing(files);
  const status = useModels((s) => s.status);
  const [open, setOpen] = useState(false);
  if (!missing) return null;
  const ready = !missing.length;
  const downloading = missing.some((f) => ["queued", "downloading"].includes(status?.files[f]?.job?.state ?? ""));
  const size = missing.reduce((s, f) => s + (MODEL_FILES[f]?.size ?? 0), 0);
  return (
    <li className="flex flex-col gap-2 py-2.5">
      <button onClick={() => !ready && setOpen(!open)} className={clsx("flex items-center gap-3 text-left", !ready && "hover:text-ink")} aria-expanded={ready ? undefined : open || downloading}>
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] text-ink">{name}</span>
          <span className="block text-[12px] text-dim">{tr(hint)}</span>
        </span>
        {ready ? (
          <span className="flex shrink-0 items-center gap-1 text-[12px] text-ok">
            <Check size={13} /> {tr("Ready")}
          </span>
        ) : (
          <span className="flex shrink-0 items-center gap-1 text-[12px] text-dim">
            {downloading ? tr("Downloading…") : tr("{size} to get", { size: formatBytes(size) })}
            <ChevronDown size={13} className={clsx("transition-transform", (open || downloading) && "rotate-180")} />
          </span>
        )}
      </button>
      {!ready && (open || downloading) && <GetModels name={name} files={files} />}
    </li>
  );
}
