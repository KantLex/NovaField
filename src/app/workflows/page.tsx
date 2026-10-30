"use client";

import clsx from "clsx";
import { AnimatePresence } from "motion/react";
import { FileJson, LayoutTemplate } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { isEngine } from "@/lib/workflows/apply";
import { blockingMissing } from "@/lib/workflows/missing";
import { TakeStrip } from "@/ui/TakeStrip";
import { TemplateBrowser } from "@/ui/workflows/TemplateBrowser";
import { useRecipes } from "@/ui/workflows/store";
import { confirmDiscard } from "@/ui/unsaved";
import { columnWidth, SidePanel, usePanelKeys, usePanelOpen } from "@/ui/SidePanel";
import { tr } from "@/i18n";
import { ImportZone, ServerWorkflows } from "@/ui/workflows/ImportZone";
import { Detail, type Mode, OUTPUT_LABEL } from "@/ui/workflows/Detail";

const KINDS = ["workflow" as const];

export default function WorkflowsPageShell() {
  // The page reads the URL (?open=…&mode=graph), so it renders on the client below this boundary.
  return (
    <Suspense>
      <WorkflowsPage />
    </Suspense>
  );
}

function WorkflowsPage() {
  const { list, loaded, refresh } = useRecipes();
  const [selected, setSelected] = useState<string | null>(null);
  const [browsing, setBrowsing] = useState(false);
  // Links from elsewhere ("Edit as workflow" on a take) open a workflow straight in a view.
  const params = useSearchParams();
  const linked = params.get("open");
  const linkedMode = params.get("mode");
  const openMode: Mode | undefined = linkedMode === "graph" || linkedMode === "customise" || linkedMode === "run" ? linkedMode : undefined;
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const current = selected ?? linked ?? list[0]?.id ?? null;
  const listOpen = usePanelOpen("workflows-list");
  usePanelKeys({ left: "workflows-list" });

  return (
    <div className="grid flex-1 grid-cols-[minmax(0,1fr)] gap-3 p-3 lg:grid-cols-[var(--nf-left)_minmax(0,1fr)]" style={{ "--nf-left": columnWidth(listOpen, "300px") } as React.CSSProperties}>
      <SidePanel
        id="workflows-list"
        side="left"
        label="Workflows"
        className="rounded-md bg-panel lg:sticky lg:top-[69px] lg:max-h-[calc(100dvh_-_81px)]"
        bodyClassName="flex flex-col gap-4 p-4 lg:overflow-y-auto"
      >
        <div>
          <h1 className="display text-[22px] leading-tight">{tr("Workflows")}</h1>
          <p className="mt-1 text-[13px] text-dim">
            {tr("Bring a ComfyUI workflow. NovaField reads it and gives it a simple form; ones with a prompt also work as a Studio model.")}
          </p>
        </div>
        <button
          onClick={() => setBrowsing(true)}
          className="flex items-center gap-2.5 rounded-md bg-tungsten/12 px-3 py-2.5 text-left text-tungsten transition-colors hover:bg-tungsten/20"
        >
          <LayoutTemplate size={18} className="shrink-0" />
          <span className="flex flex-col">
            <span className="text-[14px] font-semibold">{tr("Browse ComfyUI templates")}</span>
            <span className="text-[12px] text-tungsten/75">{tr("Hundreds of ready workflows: Wan, Flux, LTX, upscalers, audio…")}</span>
          </span>
        </button>
        <ImportZone onImported={(r) => setSelected(r.id)} />
        <div className="flex flex-col gap-1">
          {!loaded && <p className="text-[13px] text-faint">{tr("Loading…")}</p>}
          {list.map((r) => (
            <button
              key={r.id}
              onClick={() => r.id !== current && confirmDiscard() && setSelected(r.id)}
              className={clsx("flex flex-col gap-0.5 rounded-md px-3 py-2 text-left transition-colors", current === r.id ? "bg-raised" : "hover:bg-surround")}
            >
              <span className="truncate text-[14px]">{r.name}</span>
              <span className="flex flex-wrap gap-x-2 text-[12px] text-faint">
                {blockingMissing(r.missing).length ? <span className="text-tungsten">{tr("Needs node packs")}</span> : <span>{tr(OUTPUT_LABEL[r.output])}</span>}
                {isEngine(r) && <span className="text-tungsten">{tr("Studio model")}</span>}
                {(r.paid?.length ?? 0) > 0 && <span className="text-daylight">{tr("Paid API")}</span>}
              </span>
            </button>
          ))}
        </div>
        <ServerWorkflows onImported={(r) => setSelected(r.id)} />
      </SidePanel>

      <section className="flex min-w-0 flex-col gap-3">
        {current ? (
          <Detail key={current} id={current} initialMode={current === linked ? openMode : undefined} onDeleted={() => setSelected(null)} />
        ) : (
          loaded && (
            <div className="flex flex-1 flex-col items-start justify-center gap-3 rounded-md bg-panel p-8">
              <FileJson className="text-faint" size={28} />
              <p className="max-w-[56ch] text-[15px]">
                {tr("Start from one of ComfyUI's templates, or bring your own: in ComfyUI, use Workflow → Save (or Export), then drop the .json file on the left.")}
              </p>
            </div>
          )
        )}
        <TakeStrip kinds={KINDS} empty={tr("Workflow runs land here.")} />
      </section>
      <AnimatePresence>{browsing && <TemplateBrowser onClose={() => setBrowsing(false)} onImported={(r) => setSelected(r.id)} />}</AnimatePresence>
    </div>
  );
}
