"use client";

// Making a new asset: what kind it is, its name and description, and the files it starts from.

import clsx from "clsx";
import { LoaderCircle, Upload, X } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { ASSET_KINDS, handleOf, type AssetEntry, type AssetKind } from "@/lib/assets";
import { fail, toast } from "@/ui/api";
import { useAssets } from "@/ui/assets/store";
import { tr } from "@/i18n";

/** Drop zone for adding files straight to an asset (kept as originals; conformed when used). */
export function FileDrop({ onFiles, busy, compact }: { onFiles: (f: File[]) => void; busy: boolean; compact?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => !busy && input.current?.click()}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const media = onlyMedia(Array.from(e.dataTransfer.files));
        if (media.length) onFiles(media);
      }}
      className={clsx(
        "flex cursor-pointer flex-col items-center justify-center gap-1 rounded-[5px] border border-dashed text-center text-[12px] transition-colors",
        compact ? "aspect-[4/5]" : "px-3 py-6",
        over ? "border-tungsten text-ink" : "border-line text-faint hover:border-dim hover:text-dim",
      )}
    >
      <input
        ref={input}
        type="file"
        multiple
        accept="image/*,video/*,audio/*"
        className="hidden"
        onChange={(e) => {
          const media = onlyMedia(Array.from(e.target.files ?? []));
          if (media.length) onFiles(media);
          e.target.value = "";
        }}
      />
      {busy ? <LoaderCircle size={18} className="animate-spin" /> : <Upload size={18} />}
      {tr(busy ? "Adding…" : compact ? "Add" : "Drop pictures, clips or audio")}
    </div>
  );
}

/** Pictures, clips and audio; anything else (a PDF, notes) is left out, with a word about it. */
function onlyMedia(files: File[]) {
  const media = files.filter((f) => /^(image|video|audio)\//.test(f.type));
  if (media.length < files.length) toast(tr("Only pictures, clips and audio can be added. Left out: {names}", { names: files.filter((f) => !media.includes(f)).map((f) => f.name).join(", ") }), "error");
  return media;
}

export function CreateForm({ kind, onKind, onDone, onCancel }: { kind: AssetKind; onKind: (k: AssetKind) => void; onDone: (id: string) => void; onCancel: () => void }) {
  const { create, addFiles } = useAssets.getState();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const meta = ASSET_KINDS.find((k) => k.id === kind)!;
  // If the files fail after the asset was made, "Add" again fills that asset instead of making another.
  const made = useRef<AssetEntry | null>(null);

  const submit = async () => {
    setBusy(true);
    try {
      const e = (made.current ??= await create({ name: name || files[0]?.name.replace(/\.[^.]+$/, "") || meta.label, kind, description }));
      if (files.length) await addFiles(e.id, files);
      toast(tr("Added “{name}”. Mention it as @{handle}.", { name: e.name, handle: handleOf(e.name) }), "done");
      onDone(e.id);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="flex flex-col gap-4 rounded-md bg-panel p-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="flex items-center justify-between">
        <h2 className="display text-[20px]">{tr("New {kind}", { kind: tr(meta.label).toLowerCase() })}</h2>
        <button type="button" onClick={onCancel} className="rounded p-1 text-dim hover:bg-raised hover:text-ink" aria-label={tr("Cancel")}>
          <X size={16} />
        </button>
      </div>
      <KindChips value={kind} onChange={onKind} />
      <p className="-mt-2 text-[12px] text-faint">{tr(meta.hint)}</p>
      <NameInput value={name} onChange={setName} placeholder={kind === "character" ? "Mira" : kind === "location" ? tr("Night market") : tr(meta.label)} autoFocus />
      <DescriptionInput value={description} onChange={setDescription} kind={kind} />
      <div className="flex flex-col gap-2">
        <span className="text-[13px] font-semibold text-dim">{tr("Files")}</span>
        {files.length > 0 && (
          <div className="grid grid-cols-4 gap-1.5">
            {files.map((f, i) => (
              <span key={i} className="group relative aspect-[4/5] overflow-hidden rounded-[4px] bg-surround">
                {f.type.startsWith("image") ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <FileThumb file={f} />
                ) : (
                  <span className="flex size-full items-center justify-center p-1 text-center text-[10px] break-all text-dim">{f.name}</span>
                )}
                <button
                  type="button"
                  onClick={() => setFiles((fs) => fs.filter((_, j) => j !== i))}
                  className="absolute top-1 right-1 rounded bg-black/70 p-0.5 opacity-0 group-hover:opacity-100"
                  aria-label={tr("Remove {name}", { name: f.name })}
                >
                  <X size={11} />
                </button>
              </span>
            ))}
          </div>
        )}
        <FileDrop busy={false} onFiles={(f) => setFiles((fs) => [...fs, ...f].slice(0, 24))} />
      </div>
      <button type="submit" disabled={busy} className="flex items-center justify-center gap-2 rounded-md bg-tungsten px-3 py-2 text-[14px] font-semibold text-black disabled:opacity-50">
        {busy && <LoaderCircle size={14} className="animate-spin" />}
        {tr("Add {kind}", { kind: tr(meta.label).toLowerCase() })}
      </button>
    </form>
  );
}

export function KindChips({ value, onChange }: { value: AssetKind; onChange: (k: AssetKind) => void }) {
  return (
    <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={tr("Type")}>
      {ASSET_KINDS.map((k) => (
        <button
          type="button"
          key={k.id}
          role="radio"
          aria-checked={value === k.id}
          onClick={() => onChange(k.id)}
          className={clsx("rounded-full px-2.5 py-1 text-[12px]", value === k.id ? "bg-ink text-surround" : "bg-surround text-dim hover:text-ink")}
        >
          {tr(k.label)}
        </button>
      ))}
    </div>
  );
}

export function NameInput({ value, onChange, placeholder, autoFocus, onBlur }: { value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean; onBlur?: () => void }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="flex items-baseline justify-between text-[13px] font-semibold text-dim">
        {tr("Name")}
        {value && <span className="text-[12px] font-normal text-tungsten">{tr("mention as @{handle}", { handle: handleOf(value) })}</span>}
      </span>
      <input
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        maxLength={40}
        className="rounded-md bg-surround px-3 py-2 text-[15px] focus:outline-none focus-visible:ring-1 focus-visible:ring-tungsten/60"
      />
    </label>
  );
}

export function DescriptionInput({ value, onChange, kind, onBlur }: { value: string; onChange: (v: string) => void; kind: AssetKind; onBlur?: () => void }) {
  const example = tr(
    kind === "character"
      ? "a woman in her 30s, silver bob, small scar over the left eyebrow, red raincoat"
      : kind === "object"
        ? "a matte black thermos with an orange cap and a debossed logo"
        : kind === "location"
          ? "a narrow night market alley, wet cobbles, paper lanterns, steam from food stalls"
          : kind === "style"
            ? "faded 70s Kodachrome, warm halation, soft grain, low contrast"
            : "handheld street footage, overcast",
  );
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[13px] font-semibold text-dim">{tr("Description")}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        rows={3}
        maxLength={600}
        placeholder={example}
        className="resize-y rounded-md bg-surround px-3 py-2 text-[14px] leading-relaxed placeholder:text-faint focus:outline-none focus-visible:ring-1 focus-visible:ring-tungsten/60"
      />
      <span className="text-[12px] text-faint">{tr("What the pictures don't say. It goes into the prompt the first time a script mentions this asset.")}</span>
    </label>
  );
}

/** A picture not uploaded yet: one blob URL for the file, let go when it's removed. */
function FileThumb({ file }: { file: File }) {
  const show = useCallback(
    (img: HTMLImageElement | null) => {
      if (!img) return;
      const url = URL.createObjectURL(file);
      img.src = url;
      return () => URL.revokeObjectURL(url);
    },
    [file],
  );
  // eslint-disable-next-line @next/next/no-img-element
  return <img ref={show} alt="" className="size-full object-cover" />;
}
