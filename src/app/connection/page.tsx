"use client";

import clsx from "clsx";
import { ArrowUpRight, Check, Cloud, ClipboardCheck, ExternalLink, KeyRound, LoaderCircle, Monitor, PlugZap, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { looksLikeComfyKey } from "@/lib/comfy/key";
import type { ConnectionMode, ConnectionTest, PublicConnection } from "@/server/connection";
import { Button } from "@/ui/controls";
import { ApiError, fail, request, toast } from "@/ui/api";
import { PROBLEMS, SHOW_MODE } from "@/ui/connection";
import { useLive } from "@/ui/state";
import { tr } from "@/i18n";

const KEY_PAGE = "https://platform.comfy.org/profile/api-keys";
const PLANS_PAGE = "https://comfy.org/cloud/pricing";


const MODES: { id: ConnectionMode; title: string; blurb: string }[] = [
  {
    id: "local",
    title: "Local ComfyUI",
    blurb: "Your own GPU, on this computer or another one on your network. Free to run, and NovaField's node pack can be installed.",
  },
  {
    id: "cloud",
    title: "Comfy Cloud",
    blurb: "Comfy's GPUs, no install. Needs a Creator or Pro plan; renders use your Comfy credits. Custom node packs can't be added.",
  },
];

const KEYS = {
  api: { label: "Comfy account API key (optional)", hint: "Only for ComfyUI's API nodes (GPT Image, Kling, Flux Pro…), which bill your Comfy account." },
  cloud: { label: "Comfy Cloud API key", hint: "Or paste a key here; NovaField connects as soon as it works." },
};

const field = "h-9 w-full min-w-0 rounded-md bg-raised px-3 text-[13px] placeholder:text-faint focus:outline-none focus:ring-1 focus:ring-tungsten/60";

export default function ConnectionPage() {
  const [saved, setSaved] = useState<PublicConnection | null>(null);
  const [mode, setMode] = useState<ConnectionMode>("local");
  const [url, setUrl] = useState("");
  const [cloudKey, setCloudKey] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState<"test" | "save" | null>(null);
  const [result, setResult] = useState<ConnectionTest | null>(null);
  /** A key found on the clipboard after "Get my key", waiting for a yes. */
  const [offer, setOffer] = useState<string | null>(null);
  const awaitingKey = useRef(false);
  const status = useLive((s) => s.status);

  // Back from platform.comfy.org: if a key was just copied, offer it. The browser may ask
  // first or refuse; then the paste field is the way in.
  useEffect(() => {
    const onFocus = async () => {
      if (!awaitingKey.current) return;
      awaitingKey.current = false;
      try {
        const text = await navigator.clipboard.readText();
        if (looksLikeComfyKey(text)) setOffer(text.trim());
      } catch {
        /* no clipboard access */
      }
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  useEffect(() => {
    void request<PublicConnection>("/api/connection")
      .then((c) => {
        setSaved(c);
        // The header's Local / Cloud switch sends people here with the tab to show.
        const asked = new URLSearchParams(window.location.search).get("mode");
        setMode(asked === "cloud" || asked === "local" ? asked : c.mode);
        setUrl(c.url);
      })
      .catch(fail);
  }, []);

  useEffect(() => {
    const onShow = (e: Event) => {
      const m = (e as CustomEvent).detail;
      if (m !== "cloud" && m !== "local") return;
      setMode(m);
      setResult(null);
    };
    window.addEventListener(SHOW_MODE, onShow);
    return () => window.removeEventListener(SHOW_MODE, onShow);
  }, []);

  const pick = (m: ConnectionMode) => {
    setMode(m);
    setResult(null);
  };

  const put = async (body: Record<string, unknown>, kind: "test" | "save") => {
    setBusy(kind);
    try {
      const j = await request<{ test?: ConnectionTest; connection?: PublicConnection }>("/api/connection", { method: "PUT", json: body }).catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 409 && e.body.live) throw new Error(tr("Takes are still rendering ({n}). Let them finish or cancel them, then switch.", { n: Number(e.body.live) }));
        throw e;
      });
      setResult(j.test ?? null);
      if (j.connection) {
        // The key is on the server now; drop every copy of it here.
        setSaved(j.connection);
        setCloudKey("");
        setApiKey("");
        setOffer(null);
        toast(j.test?.ok ? "Connected. NovaField now sends its work here." : "Saved, but it isn't answering yet.", j.test?.ok ? "done" : "info");
      }
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  // An empty key field keeps the saved key.
  const send = (test: boolean) => put({ mode, url, test, ...(cloudKey.trim() ? { cloudKey } : {}), ...(apiKey.trim() ? { apiKey } : {}) }, test ? "test" : "save");

  /** Test a Cloud key and, only if it works, save and switch in the same step. */
  const connectKey = (key: string) => {
    setOffer(null);
    setCloudKey(key);
    return put({ mode: "cloud", url, cloudKey: key, ifWorks: true }, "save");
  };

  const getKey = () => {
    awaitingKey.current = true;
    setOffer(null);
    window.open(KEY_PAGE, "_blank", "noopener,noreferrer");
  };

  const current = saved && (saved.mode === "cloud" ? tr("Comfy Cloud") : saved.url);
  const online = status?.online && !status.dryRun;

  return (
    <div className="mx-auto flex w-full max-w-[880px] flex-col gap-5 px-4 py-6 sm:px-6">
      <div>
        <h1 className="display text-[30px] leading-tight">{tr("Connection")}</h1>
        <p className="max-w-[64ch] text-[13px] text-dim">
          {tr("Choose the ComfyUI that renders your takes: one on this computer or your network, or Comfy Cloud if you subscribe. Keys stay on this computer.")}
        </p>
      </div>

      {saved && (
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-panel px-3.5 py-2.5 text-[13px]">
          <span className={clsx("size-2 rounded-full", online ? "bg-ok" : "bg-faint")} aria-hidden />
          <span className="text-dim">{tr("Now using")}</span>
          <span className="readout min-w-0 truncate">{current}</span>
          <span className="text-faint">·</span>
          <span className="text-dim">{online ? tr("online") : tr("not answering")}</span>
          {status?.version && <span className="readout text-faint">ComfyUI {status.version}</span>}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label={tr("Where to render")}>
        {MODES.map((m) => (
          <ModeCard key={m.id} active={mode === m.id} onPick={() => pick(m.id)} icon={m.id === "local" ? <Monitor size={18} /> : <Cloud size={18} />} title={m.title} blurb={m.blurb} />
        ))}
      </div>

      <section className="flex flex-col gap-4 rounded-md bg-panel p-4">
        {mode === "local" ? (
          <>
            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-semibold text-dim">{tr("ComfyUI address")}</span>
              <input value={url} onChange={(e) => (setUrl(e.target.value), setResult(null))} placeholder="http://127.0.0.1:8188" spellCheck={false} className={clsx(field, "readout")} />
              <span className="text-[12px] text-faint">
                {tr("On this computer it's usually http://127.0.0.1:8188. For another computer, start ComfyUI with --listen and use its address, like http://192.168.1.20:8188.")}
              </span>
            </label>
            <KeyField
              {...KEYS.api}
              has={!!saved?.apiKey}
              value={apiKey}
              onChange={setApiKey}
            />
          </>
        ) : (
          <>
            <div className="flex flex-col gap-2 rounded-md bg-raised/60 p-3.5 sm:flex-row sm:items-center sm:gap-4">
              <Button variant="solid" onClick={getKey} disabled={!!busy} className="shrink-0 px-4 py-2">
                <KeyRound size={14} />
                {tr("Get my key")}
                <ArrowUpRight size={14} />
              </Button>
              <span className="text-[12px] text-dim">{tr("On the page that opens, click Generate and copy the key, then come back here.")}</span>
            </div>
            {offer && (
              <div className="flex flex-wrap items-center gap-2 rounded-md bg-tungsten/10 px-3 py-2 text-[13px]">
                <ClipboardCheck size={15} className="text-tungsten" />
                <span className="min-w-0 flex-1">
                  {tr("Use the key you just copied?")} <span className="readout text-dim">comfyui-…{offer.slice(-4)}</span>
                </span>
                <Button variant="solid" onClick={() => void connectKey(offer)} disabled={!!busy}>
                  {busy === "save" ? <LoaderCircle size={14} className="animate-spin" /> : <Check size={14} />}
                  {tr("Use it and connect")}
                </Button>
                <Button onClick={() => setOffer(null)}>{tr("Not this one")}</Button>
              </div>
            )}
            <KeyField
              {...KEYS.cloud}
              has={!!saved?.cloudKey}
              value={cloudKey}
              onChange={(v) => (setCloudKey(v), setResult(null))}
              onPaste={(text) => {
                if (!looksLikeComfyKey(text)) return false;
                void connectKey(text.trim());
                return true;
              }}
            />
          </>
        )}

        {result && <TestResult result={result} />}

        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => void send(true)} disabled={!!busy}>
            {busy === "test" ? <LoaderCircle size={14} className="animate-spin" /> : <PlugZap size={14} />}
            {tr("Test connection")}
          </Button>
          <Button variant="solid" onClick={() => void send(false)} disabled={!!busy}>
            {busy === "save" ? <LoaderCircle size={14} className="animate-spin" /> : <Check size={14} />}
            {tr("Save and connect")}
          </Button>
          {mode === "cloud" && <span className="text-[12px] text-faint">{tr("Your local address is kept, so you can switch back any time.")}</span>}
        </div>
      </section>
    </div>
  );
}

function ModeCard({ active, onPick, icon, title, blurb }: { active: boolean; onPick: () => void; icon: React.ReactNode; title: string; blurb: string }) {
  return (
    <button
      role="radio"
      aria-checked={active}
      onClick={onPick}
      className={clsx(
        "flex flex-col gap-1.5 rounded-md p-4 text-left ring-1 transition-[background-color,box-shadow] duration-150",
        active ? "bg-raised ring-tungsten" : "bg-panel ring-transparent hover:bg-raised",
      )}
    >
      <span className={clsx("flex items-center gap-2 text-[15px] font-semibold", active ? "text-tungsten" : "text-ink")}>
        {icon}
        {tr(title)}
      </span>
      <span className="text-[13px] text-dim">{tr(blurb)}</span>
    </button>
  );
}

function KeyField({
  label,
  hint,
  has,
  value,
  onChange,
  onPaste,
}: {
  label: string;
  hint: string;
  has: boolean;
  value: string;
  onChange: (v: string) => void;
  /** Takes over a paste when it returns true. */
  onPaste?: (text: string) => boolean;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="flex items-center gap-2 text-[13px] font-semibold text-dim">
        <KeyRound size={14} />
        {tr(label)}
        {has && <span className="rounded-full bg-ok/15 px-2 text-2xs font-normal text-ok">{tr("saved")}</span>}
      </span>
      <input
        type="password"
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onPaste={(e) => {
          if (onPaste?.(e.clipboardData.getData("text"))) e.preventDefault();
        }}
        placeholder={has ? tr("Saved. Paste a new key to replace it.") : tr("Paste the key")}
        spellCheck={false}
        className={field}
      />
      <span className="text-[12px] text-faint">{tr(hint)}</span>
    </label>
  );
}

function TestResult({ result }: { result: ConnectionTest }) {
  return (
    <div className={clsx("flex items-start gap-2 rounded-md px-3 py-2 text-[13px]", result.ok ? "bg-ok/10 text-ok" : "bg-tally/10 text-tally")}>
      {result.ok ? <Check size={15} className="mt-0.5 shrink-0" /> : <TriangleAlert size={15} className="mt-0.5 shrink-0" />}
      <span>
        {result.ok ? tr("ComfyUI answered.") : null}
        {result.problem && <> {tr(PROBLEMS[result.problem])}</>}
        {result.problem === "no-plan" && (
          <a href={PLANS_PAGE} target="_blank" rel="noreferrer" className="ml-2 inline-flex items-center gap-1 text-ink underline underline-offset-2 hover:text-tungsten">
            {tr("See Comfy Cloud plans")} <ExternalLink size={12} />
          </a>
        )}
        {result.ok && (result.version || result.gpu) && (
          <span className="readout ml-2 text-dim">
            {[result.version && `ComfyUI ${result.version}`, result.gpu === "Comfy Cloud" ? tr("Comfy Cloud") : result.gpu].filter(Boolean).join(" · ")}
          </span>
        )}
      </span>
    </div>
  );
}
