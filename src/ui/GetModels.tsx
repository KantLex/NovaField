"use client";

// Getting a model's files onto the ComfyUI PC: what's missing and how big, a Download button that
// has the NovaField nodes fetch them there (with progress and Cancel), or, with older nodes, the
// links and the folder each file goes in.

import clsx from "clsx";
import { Download, ExternalLink, LoaderCircle, X } from "lucide-react";
import { useEffect } from "react";
import { create } from "zustand";
import { MODEL_FILES, type ModelsStatus } from "@/lib/modelFiles";
import { fail, request, toast } from "./api";
import { Button } from "./controls";
import { useLive, type ServerStatus } from "./state";
import { numberFormat, tr } from "@/i18n";

const POLL_MS = 1500;
/** When the status couldn't be read (the PC off or busy starting), how soon to ask again. */
const RETRY_MS = 10_000;

/** One status for every Get models panel on the page; it polls while anything downloads. */
export const useModels = create<{ status: ModelsStatus | null; load: () => Promise<void> }>((set, get) => ({
  status: null,
  load: async () => {
    const before = get().status;
    const status = await request<ModelsStatus>("/api/models").catch(() => null);
    if (!status?.files) return;
    set({ status });
    // Something finished: ComfyUI's lists change, so the features it unlocks do too.
    const finished = Object.entries(status.files).some(([n, f]) => f.job?.state === "done" && before?.files[n]?.job?.state !== "done");
    if (finished) {
      const s = await request<ServerStatus>("/api/status").catch(() => null);
      if (s) useLive.getState().setStatus(s);
    }
  },
}));

const busy = (s: ModelsStatus | null) => !!s && Object.values(s.files).some((f) => f.job?.state === "queued" || f.job?.state === "downloading");

let timer: ReturnType<typeof setTimeout> | null = null;
/** Panels on screen that want the status: while any is, a status that couldn't be read is asked for again. */
let watching = 0;
function poll() {
  if (timer) return;
  const tick = async () => {
    await useModels.getState().load();
    const { status } = useModels.getState();
    timer = busy(status) ? setTimeout(tick, POLL_MS) : !status && watching > 0 ? setTimeout(tick, RETRY_MS) : null;
  };
  timer = setTimeout(tick, 0);
}

export const formatBytes = (n: number) => {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1000 && i < units.length - 1) [v, i] = [v / 1000, i + 1];
  // Gigabytes keep a decimal (17.1 GB): model files differ by tenths.
  return `${numberFormat({ maximumFractionDigits: (i > 1 && v < 10) || (i > 2 && v < 100) ? 1 : 0 }).format(v)} ${units[i]}`;
};

/** What the server has and what's downloading, loaded the first time anything asks. */
export function useModelsStatus(): ModelsStatus | null {
  const status = useModels((s) => s.status);
  useEffect(() => {
    watching++;
    return () => void watching--;
  }, []);
  useEffect(() => {
    if (!status) poll();
  }, [status]);
  return status;
}

/** The files of `files` not on the server yet (unknown until the status loads). */
export function useMissing(files: string[]): string[] | null {
  const status = useModelsStatus();
  if (!status) return null;
  return files.filter((f) => !status.files[f]?.installed);
}

export function GetModels({ name, files, className }: { name: string; files: string[]; className?: string }) {
  const status = useModels((s) => s.status);
  const missing = useMissing(files);
  if (!status || status.cloud || !missing?.length) return null;
  const known = missing.filter((f) => f in MODEL_FILES);
  const left = known.reduce((s, f) => s + MODEL_FILES[f].size - (status.files[f]?.job?.state === "downloading" ? (status.files[f]?.job?.done ?? 0) : 0), 0);
  const active = known.some((f) => ["queued", "downloading"].includes(status.files[f]?.job?.state ?? ""));

  const start = async () => {
    try {
      await request("/api/models", { json: { files: known } });
      toast(tr("Downloading {model} on your ComfyUI PC.", { model: name }));
      poll();
    } catch (e) {
      fail(e);
    }
  };
  const cancel = (file: string) =>
    request("/api/models/cancel", { json: { file } })
      .then(poll)
      .catch(fail);

  return (
    <div className={clsx("flex flex-col gap-2 rounded-md border border-dashed border-line px-3 py-2.5 text-[12px]", className)}>
      <p className="text-dim">
        {status.pack
          ? tr("{model} needs these files on your ComfyUI PC.", { model: name })
          : tr("{model} needs these files on your ComfyUI PC. Put each in the models folder shown, or update the NovaField nodes (0.5.0 or later) to download them from here.", { model: name })}
      </p>
      <ul className="flex flex-col gap-1.5">
        {missing.map((f) => {
          const entry = MODEL_FILES[f];
          const job = status.files[f]?.job;
          const pct = job && job.total ? Math.min(100, (job.done / job.total) * 100) : 0;
          const running = job?.state === "queued" || job?.state === "downloading";
          return (
            <li key={f} className="flex flex-col gap-1">
              <span className="flex items-center gap-2">
                {/* File names are long and unbroken: let them wrap anywhere. */}
                <span className="min-w-0 flex-1 text-ink/85 [overflow-wrap:anywhere]">
                  {entry && !status.pack ? (
                    <a href={entry.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-ink hover:underline">
                      {f}
                      <ExternalLink size={11} className="shrink-0" />
                    </a>
                  ) : (
                    f
                  )}
                </span>
                {running ? (
                  <button onClick={() => void cancel(f)} className="shrink-0 rounded p-0.5 text-dim hover:bg-raised hover:text-ink" aria-label={tr("Cancel {file}", { file: f })}>
                    <X size={12} />
                  </button>
                ) : (
                  <span className="readout shrink-0 text-[12px] text-faint">{entry ? formatBytes(entry.size) : ""}</span>
                )}
              </span>
              {entry && !status.pack && <span className="text-faint">{tr("Goes in models/{folder}", { folder: entry.folder })}</span>}
              {!entry && <span className="text-faint">{tr("NovaField can't download this one; get it where you got the model.")}</span>}
              {running && (
                <span className="flex items-center gap-2">
                  <span className="h-1 flex-1 overflow-hidden rounded-full bg-raised">
                    <span className="block h-full rounded-full bg-tungsten transition-[width]" style={{ width: `${pct}%` }} />
                  </span>
                  <span className="readout w-28 shrink-0 text-right text-[12px] text-dim">
                    {job.state === "queued" ? tr("Waiting") : `${formatBytes(job.done)} / ${formatBytes(job.total)}`}
                  </span>
                </span>
              )}
              {job?.state === "failed" && <span className="text-tally">{job.error}</span>}
            </li>
          );
        })}
      </ul>
      {status.pack && known.length > 0 && !active && (
        <Button variant="solid" className="self-start" onClick={() => void start()}>
          <Download size={13} />
          {tr("Download {size}", { size: formatBytes(left) })}
        </Button>
      )}
      {active && (
        <span className="flex items-center gap-1.5 text-dim">
          <LoaderCircle size={12} className="animate-spin" />
          {tr("Downloading on your ComfyUI PC. You can keep working; it unlocks when it's done.")}
        </span>
      )}
    </div>
  );
}
