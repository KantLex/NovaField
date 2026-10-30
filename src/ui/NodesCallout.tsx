"use client";

import clsx from "clsx";
import { Check, ExternalLink, LoaderCircle, Monitor, Package, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { create } from "zustand";
import { fail, packs, request, toast } from "./api";
import { switchMode } from "./connection";
import { Button } from "./controls";
import { useLive, type ServerStatus } from "./state";
import { tr } from "@/i18n";

interface NodesStatus {
  installed: boolean;
  missing: string[];
  manager: string | null;
  source: { kind: "registry"; version: string | null } | { kind: "github"; url: string } | null;
}
type Phase = "idle" | "confirm" | "installing" | "failed" | "restart" | "restarting";

interface Install {
  status: NodesStatus | null;
  phase: Phase;
  message: string | null;
  busy: number | null;
  load: () => Promise<void>;
  set: (p: Partial<Install>) => void;
}

// One install at a time, shared by every callout on the page.
const useInstall = create<Install>((set) => ({
  status: null,
  phase: "idle",
  message: null,
  busy: null,
  load: async () => {
    try {
      set({ status: await request<NodesStatus>("/api/nodes") });
    } catch {
      /* the server will answer next time */
    }
  },
  set: (p) => set(p),
}));

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function install() {
  const { set } = useInstall.getState();
  set({ phase: "installing", message: null });
  try {
    const { tasks } = await request<{ tasks: Record<string, string> }>("/api/nodes/install", { method: "POST" });
    for (let i = 0; i < 240; i++) {
      await wait(2500);
      const s = await packs.status(tasks);
      const all = Object.values(s);
      if (all.length && all.every((x) => x.state !== "waiting")) {
        const failed = all.find((x) => x.state === "failed");
        if (failed) return set({ phase: "failed", message: failed.message ?? "The install failed. ComfyUI's console has the details." });
        return set({ phase: "restart" });
      }
    }
    set({ phase: "failed", message: "The install is taking more than 10 minutes. Check ComfyUI Manager on the PC." });
  } catch (e) {
    set({ phase: "failed", message: e instanceof Error ? e.message : String(e) });
  }
}

async function restart(force: boolean) {
  const { set, load } = useInstall.getState();
  let stopping: number | null;
  try {
    stopping = await packs.restart(force);
  } catch (e) {
    return fail(e);
  }
  if (stopping !== null) return set({ busy: stopping });
  set({ phase: "restarting", busy: null });
  await wait(5000);
  for (let i = 0; i < 80; i++) {
    const s = await request<ServerStatus>("/api/status").catch(() => null);
    if (s?.online && s.caps.pack.lensFilm) {
      useLive.getState().setStatus(s);
      set({ phase: "idle" });
      await load();
      toast("The NovaField nodes are installed. Previs, the film lab and Replace are unlocked.", "done");
      return;
    }
    if (s?.online && i > 10) {
      // Back up, but the nodes didn't load.
      set({ phase: "failed", message: "ComfyUI restarted but the NovaField nodes didn't load. ComfyUI's console shows why (look for comfyui-novafield)." });
      await load();
      return;
    }
    await wait(3000);
  }
  set({ phase: "restart" });
  toast("ComfyUI hasn't come back after 4 minutes. Check the PC.", "error");
}

function OnCloud({ feature }: { feature: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex flex-col gap-2 rounded-md border border-dashed border-line px-3 py-2.5 text-[12px] text-dim">
      <p className="flex items-start gap-2">
        <Package size={14} className="mt-px shrink-0 text-tungsten" />
        <span>{tr("{feature} needs NovaField's own ComfyUI nodes. Comfy Cloud can't load custom nodes, so it works on your local ComfyUI only.", { feature })}</span>
      </p>
      <div>
        <Button
          variant="solid"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await switchMode("local", router.push);
            setBusy(false);
          }}
        >
          {busy ? <LoaderCircle size={13} className="animate-spin" /> : <Monitor size={13} />} {tr("Switch to local ComfyUI")}
        </Button>
      </div>
    </div>
  );
}

/**
 * Shown where a feature needs NovaField's ComfyUI nodes: says what's missing and installs the
 * pack through ComfyUI Manager (install, restart ComfyUI, done) without leaving the app.
 */
export function NodesCallout({ feature }: { feature: string }) {
  const { status, phase, message, busy, load, set } = useInstall();
  const packReady = useLive((s) => s.status?.caps.pack.lensFilm && s.status.caps.pack.ghostRig && s.status.caps.pack.boxTrack);
  const cloud = useLive((s) => s.status?.mode === "cloud");

  useEffect(() => {
    if (!useInstall.getState().status) void load();
  }, [load]);

  if (packReady || status?.installed) return null;
  // Comfy Cloud runs its own fixed set of nodes, so there's nothing to install there.
  if (cloud) return <OnCloud feature={feature} />;

  const from = status?.source?.kind === "registry" ? `${tr("the Comfy Registry")}${status.source.version ? ` (v${status.source.version})` : ""}` : status?.source?.kind === "github" ? "GitHub" : null;

  return (
    <div className="flex flex-col gap-2 rounded-md border border-dashed border-line px-3 py-2.5 text-[12px] text-dim">
      <p className="flex items-start gap-2">
        <Package size={14} className="mt-px shrink-0 text-tungsten" />
        <span>
          {tr("{feature} runs as a ComfyUI node from NovaField's own node pack, which isn't on your server yet.", { feature })}
        </span>
      </p>

      {phase === "idle" && status && (
        <>
          {status.manager && status.source ? (
            <div>
              <Button variant="solid" onClick={() => set({ phase: "confirm" })}>
                {tr("Install NovaField nodes")}
              </Button>
            </div>
          ) : (
            <ManualSteps repo={status.source?.kind === "github" ? status.source.url : undefined} reason={tr(!status.manager ? "ComfyUI Manager isn't reachable, so install it by hand:" : "The pack isn't published yet, so install it by hand:")} />
          )}
        </>
      )}

      {phase === "confirm" && (
        <div className="flex flex-col gap-2 rounded bg-tungsten/10 p-2.5 text-ink">
          <p>
            {tr("ComfyUI Manager downloads the NovaField node pack from {source} onto your ComfyUI PC. It only needs torch and numpy, which ComfyUI already has. ComfyUI restarts afterwards to load it.", { source: from ?? "" })}
          </p>
          <div className="flex gap-2">
            <Button variant="solid" onClick={() => void install()}>
              {tr("Install")}
            </Button>
            <Button onClick={() => set({ phase: "idle" })}>{tr("Cancel")}</Button>
          </div>
        </div>
      )}

      {phase === "installing" && (
        <p className="flex items-center gap-2 text-ink">
          <LoaderCircle size={13} className="animate-spin" /> {tr("Installing with ComfyUI Manager…")}
        </p>
      )}

      {(phase === "restart" || phase === "restarting") && (
        <div className="flex flex-col gap-2 text-ink">
          <p className="flex items-center gap-1.5">
            <Check size={13} className="text-ok" /> {tr("Installed. ComfyUI loads it after a restart (about a minute).")}
          </p>
          {busy !== null && (
            <p className="text-tally">
              {busy > 1
                ? tr("ComfyUI is busy with {n} jobs, possibly from other apps or people. Restarting stops them.", { n: busy })
                : tr("ComfyUI is busy with 1 job, possibly from other apps or people. Restarting stops it.")}
            </p>
          )}
          {phase === "restarting" ? (
            <span className="flex items-center gap-2 text-dim">
              <LoaderCircle size={13} className="animate-spin" /> {tr("Waiting for ComfyUI to come back…")}
            </span>
          ) : busy !== null ? (
            <div className="flex gap-2">
              <Button variant="danger" onClick={() => void restart(true)}>
                {tr("Restart anyway")}
              </Button>
              <Button onClick={() => set({ busy: null })}>{tr("Wait")}</Button>
            </div>
          ) : (
            <div>
              <Button variant="solid" onClick={() => void restart(false)}>
                <RotateCcw size={13} /> {tr("Restart ComfyUI")}
              </Button>
            </div>
          )}
        </div>
      )}

      {phase === "failed" && (
        <div className="flex flex-col gap-2">
          <p className="text-tally">{message && tr(message)}</p>
          <ManualSteps repo={status?.source?.kind === "github" ? status.source.url : undefined} reason={tr("You can also install it by hand:")} />
          <div>
            <Button onClick={() => set({ phase: "idle", message: null })}>{tr("Try again")}</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ManualSteps({ reason, repo }: { reason: string; repo?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <p>{reason}</p>
      {repo && (
        <>
          <p className="text-ink/85">{tr("In a terminal on the ComfyUI PC, inside its custom_nodes folder:")}</p>
          <code className="readout self-start rounded bg-surround px-2 py-1 text-[13px] text-ink select-all">git clone {repo}</code>
          <p className="pt-1">{tr("Or:")}</p>
        </>
      )}
      <ol className={clsx("list-decimal pl-5 text-ink/85")}>
        <li>
          {tr("Copy the comfyui-novafield folder from this project into ComfyUI's custom_nodes folder.")}
        </li>
        <li>{tr("Restart ComfyUI. NovaField notices the new nodes by itself.")}</li>
      </ol>
      <a
        href="https://docs.comfy.org/installation/install_custom_node"
        target="_blank"
        rel="noreferrer"
        className="flex items-center gap-1 self-start text-dim hover:text-ink"
      >
        {tr("ComfyUI's guide to installing custom nodes")} <ExternalLink size={11} />
      </a>
    </div>
  );
}
