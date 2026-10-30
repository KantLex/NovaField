"use client";

import { AnimatePresence } from "motion/react";
import { ImagePlus, Library } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Drop } from "@/ui/Drop";
import { AssetPicker } from "@/ui/assets/AssetPicker";
import { openAssetInLab, isPicture, useLab, versions } from "@/ui/image/state";
import { ToolPanel } from "@/ui/image/ToolPanel";
import { Trail } from "@/ui/image/Trail";
import { Viewer } from "@/ui/image/Viewer";
import { useLive } from "@/ui/state";
import { TakeActions } from "@/ui/TakeActions";
import { TakeStrip } from "@/ui/TakeStrip";
import { useRecipes } from "@/ui/workflows/store";
import { columnWidth, SidePanel, usePanelKeys, usePanelOpen } from "@/ui/SidePanel";
import { tr } from "@/i18n";

export default function ImagePage() {
  const router = useRouter();
  const jobs = useLive((s) => s.jobs);
  const focus = useLive((s) => (s.focus ? s.jobs[s.focus] : null));
  const asset = useLab((s) => s.asset);
  const [measured, setMeasured] = useState<{ key: string; width: number; height: number } | null>(null);
  const [picking, setPicking] = useState(false);
  const panelOpen = usePanelOpen("image-tools");
  usePanelKeys({ right: "image-tools" });
  // A picture take on the monitor wins; otherwise the upload or frame brought here.
  const job = focus && isPicture(focus) ? focus : null;
  const shown = job ? null : asset;
  const list = useMemo(() => versions(jobs, job, shown), [jobs, job, shown]);
  const key = job?.id ?? shown?.name ?? null;
  // The picture's size: known for uploads, measured on screen for takes.
  const size = shown?.width && shown.height ? { width: shown.width, height: shown.height } : measured?.key === key ? measured : null;
  useEffect(() => {
    void useRecipes.getState().refresh();
  }, []);

  return (
    <div className="grid flex-1 grid-cols-[minmax(0,1fr)] gap-3 p-3 lg:grid-cols-[minmax(0,1fr)_var(--nf-right)]" style={{ "--nf-right": columnWidth(panelOpen, "340px") } as React.CSSProperties}>
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
          <div>
            <h1 className="display text-[22px] leading-tight">{tr("Image")}</h1>
            <p className="mt-1 max-w-[62ch] text-[13px] text-dim">
              {tr("Edit, upscale and widen any picture: a generated still, a video frame or your own photo. Each step is a new version; the original stays.")}
            </p>
          </div>
          <div className="ml-auto flex gap-1.5">
            <Drop purpose="image" accept="image/*" assets={false} onAsset={(a) => openAssetInLab(a, router.push)} className="rounded-md">
              {() => (
                <span className="flex items-center gap-1.5 rounded-md bg-raised px-3 py-1.5 text-[13px] hover:bg-hover">
                  <ImagePlus size={14} />
                  {tr("Open a picture")}
                </span>
              )}
            </Drop>
            <button onClick={() => setPicking(true)} className="flex items-center gap-1.5 rounded-md bg-raised px-3 py-1.5 text-[13px] hover:bg-hover">
              <Library size={14} />
              {tr("From assets")}
            </button>
          </div>
        </div>

        <div className="flex min-h-[360px] flex-1 items-center justify-center rounded-[3px] bg-monitor p-3 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)]">
          <div className="relative h-[min(68dvh,720px)] w-full">
            <Viewer job={job} asset={shown} onSize={(s) => key && setMeasured({ key, ...s })} />
          </div>
        </div>
        {job?.status === "done" && <TakeActions job={job} inline without={["graph", "lab", "upscale", "use-lab"]} />}

        <Trail list={list} current={key} />
        <TakeStrip pictures empty={tr("Your pictures land here: generated stills, edits and upscales.")} />
      </div>

      <SidePanel
        id="image-tools"
        side="right"
        label="Tools"
        className="rounded-md bg-panel lg:sticky lg:top-[69px] lg:max-h-[calc(100dvh_-_81px)]"
        bodyClassName="flex flex-col gap-6 p-4 lg:overflow-y-auto"
      >
        <ToolPanel job={job} asset={shown} size={size} />
      </SidePanel>

      <AnimatePresence>
        {picking && (
          <AssetPicker
            media={["image"]}
            purpose="image"
            mode="single"
            onPick={(list) => list[0] && openAssetInLab(list[0], router.push)}
            onClose={() => setPicking(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
