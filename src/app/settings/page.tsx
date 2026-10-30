"use client";

import clsx from "clsx";
import { ArrowUpRight, Check, FolderOpen, FolderSymlink, HardDrive, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { StorageInfo } from "@/server/storage";
import { Button } from "@/ui/controls";
import { fail, request, toast } from "@/ui/api";
import { intlLocale, tr } from "@/i18n";

const KINDS = [
  { id: "media", label: "Takes", tone: "bg-tungsten" },
  { id: "films", label: "Films", tone: "bg-ink" },
  { id: "uploads", label: "Uploads", tone: "bg-dim" },
  { id: "assets", label: "Assets", tone: "bg-faint" },
] as const;

const field = "h-9 w-full min-w-0 rounded-md bg-raised px-3 text-[13px] placeholder:text-faint focus:outline-none focus:ring-1 focus:ring-tungsten/60";

function formatBytes(n: number) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1000 && i < units.length - 1) [v, i] = [v / 1000, i + 1];
  return `${new Intl.NumberFormat(intlLocale(), { maximumFractionDigits: v < 10 && i > 1 ? 1 : 0 }).format(v)} ${units[i]}`;
}

export default function SettingsPage() {
  const [info, setInfo] = useState<StorageInfo | null>(null);
  const [typed, setTyped] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [busy, setBusy] = useState<"choose" | "copy" | null>(null);
  const [done, setDone] = useState<{ files: number; previous: string } | null>(null);

  const load = () => request<StorageInfo>("/api/storage").then(setInfo).catch(fail);
  useEffect(() => void load(), []);

  const post = (action: "choose" | "reveal") => request<{ path?: string | null }>("/api/storage", { json: { action } });

  const choose = async () => {
    setBusy("choose");
    try {
      const { path } = await post("choose");
      if (path) setPending(path);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const copy = async (root: string) => {
    setBusy("copy");
    setDone(null);
    try {
      const body = await request<{ files: number; previous: string; info: StorageInfo }>("/api/storage", { method: "PUT", json: { root } });
      setInfo(body.info);
      setDone({ files: body.files, previous: body.previous });
      setPending(null);
      setTyped("");
      toast("Your files are in the new folder.", "done");
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const total = info?.usage.total ?? 0;
  return (
    <div className="mx-auto flex w-full max-w-[880px] flex-col gap-5 px-4 py-6 sm:px-6">
      <div>
        <h1 className="display text-[30px] leading-tight">{tr("Settings")}</h1>
        <p className="max-w-[64ch] text-[13px] text-dim">{tr("Where NovaField keeps your work, and where it renders.")}</p>
      </div>

      <section className="flex flex-col gap-4 rounded-md bg-panel p-4" aria-labelledby="storage">
        <div className="flex items-start gap-3">
          <HardDrive size={18} className="mt-0.5 shrink-0 text-tungsten" />
          <div className="min-w-0">
            <h2 id="storage" className="text-[15px] font-semibold">
              {tr("Storage")}
            </h2>
            <p className="text-[13px] text-dim">{tr("Takes, films, uploads and asset files are kept in this folder. ComfyUI keeps its own copy of each render too; NovaField never deletes either.")}</p>
          </div>
        </div>

        {!info ? (
          <p className="flex items-center gap-2 text-[13px] text-dim">
            <LoaderCircle size={14} className="animate-spin" /> {tr("Measuring…")}
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 rounded-md bg-surround px-3 py-2">
              <span className="readout min-w-0 flex-1 truncate text-[13px]" title={info.root}>
                {info.root}
              </span>
              {info.isDefault && <span className="rounded bg-raised px-1.5 py-px text-[11px] text-dim">{tr("Default, inside the project")}</span>}
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex h-2.5 overflow-hidden rounded-full bg-surround" role="img" aria-label={tr("{size} in all", { size: formatBytes(total) })}>
                {KINDS.map((k) => (total ? <span key={k.id} className={clsx("h-full", k.tone)} style={{ width: `${(info.usage[k.id] / total) * 100}%` }} /> : null))}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-dim">
                {KINDS.map((k) => (
                  <span key={k.id} className="flex items-center gap-1.5">
                    <span className={clsx("size-2 rounded-full", k.tone)} />
                    {tr(k.label)} <span className="readout text-[13px] text-ink/85">{formatBytes(info.usage[k.id])}</span>
                  </span>
                ))}
                <span className="ml-auto">
                  {tr("{size} in all", { size: formatBytes(total) })}
                  {info.free !== null && <> · {tr("{size} free on this drive", { size: formatBytes(info.free) })}</>}
                </span>
              </div>
            </div>

            {done && (
              <p className="flex items-start gap-2 rounded-md bg-ok/10 px-3 py-2 text-[12px] text-ink/90">
                <Check size={14} className="mt-px shrink-0 text-ok" />
                <span>{tr("{n} files copied and checked. The old copies are still in {path}; delete them yourself once you're happy.", { n: done.files, path: done.previous })}</span>
              </p>
            )}

            {pending ? (
              <div className="flex flex-col gap-2.5 rounded-md bg-tungsten/10 p-3 text-[13px]">
                <p>
                  {tr("Copy {size} to {path}?", { size: formatBytes(total), path: pending })}
                </p>
                <p className="text-[12px] text-dim">
                  {tr("NovaField copies everything into a NovaField folder there (unless it already is one), checks every file, then switches. Nothing is deleted: the old copies stay where they are.")}
                </p>
                <div className="flex gap-2">
                  <Button variant="solid" disabled={!!busy} onClick={() => void copy(pending)}>
                    {busy === "copy" && <LoaderCircle size={13} className="animate-spin" />}
                    {busy === "copy" ? tr("Copying…") : tr("Copy and switch")}
                  </Button>
                  <Button disabled={!!busy} onClick={() => setPending(null)}>
                    {tr("Cancel")}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-2.5">
                <div className="flex flex-wrap gap-2">
                  <Button variant="solid" disabled={!!busy} onClick={() => void choose()}>
                    {busy === "choose" ? <LoaderCircle size={13} className="animate-spin" /> : <FolderSymlink size={13} />} {tr("Change folder…")}
                  </Button>
                  <Button onClick={() => void post("reveal").catch(fail)}>
                    <FolderOpen size={13} /> {tr("Show folder")}
                  </Button>
                </div>
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (typed.trim()) setPending(typed.trim());
                  }}
                >
                  <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={tr("Or type a folder path, e.g. /Volumes/Footage")} spellCheck={false} className={clsx(field, "readout")} aria-label={tr("Folder path")} />
                  <Button type="submit" disabled={!typed.trim()}>
                    {tr("Use")}
                  </Button>
                </form>
              </div>
            )}
          </>
        )}
      </section>

      <Link href="/connection" className="flex items-center gap-3 rounded-md bg-panel p-4 hover:bg-raised">
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold">{tr("Connection")}</span>
          <span className="block text-[13px] text-dim">{tr("Your local ComfyUI or Comfy Cloud, and API keys.")}</span>
        </span>
        <ArrowUpRight size={16} className="text-dim" />
      </Link>
    </div>
  );
}
