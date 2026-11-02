"use client";

// The edit's soundtrack: music or narration under the whole film. An audio take from the library
// or a file from this computer; where in it the film starts, how it mixes with the takes' own
// sound, and how loud it plays.

import { AudioLines, ChevronDown, LoaderCircle, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Job } from "@/lib/jobs";
import { timecode, type Soundtrack } from "@/lib/sequence";
import { api, fail } from "../api";
import { Button, Segmented, Slider } from "../controls";
import { Menu, MenuItem } from "../Menu";
import { tr } from "@/i18n";

const MIXES: { id: Soundtrack["mix"]; label: string; title: string }[] = [
  { id: "replace", label: "Music only", title: "The soundtrack is the only sound in the film" },
  { id: "under", label: "Under the takes", title: "The takes keep their own sound, lowered, over the soundtrack" },
];

export function SoundtrackPanel({ track, audioTakes, total, onChange }: { track: Soundtrack | null; audioTakes: Job[]; total: number; onChange: (next: Soundtrack | null) => void }) {
  const file = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  // The volume follows the slider here and is saved once it settles.
  const [draft, setDraft] = useState<number | null>(null);
  const volume = draft ?? track?.volume ?? 1;
  const pending = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(pending.current), []);

  const keep = { start: track?.start ?? 0, mix: track?.mix ?? "replace", volume: track?.volume ?? 1 } as const;
  const fromTake = (j: Job) => onChange({ take: j.id, label: j.title, ...keep, start: 0 });
  const upload = async (f: File) => {
    setUploading(true);
    try {
      const a = await api.upload(f, "track");
      onChange({ url: a.url, label: a.label ?? f.name, ...keep, start: 0 });
    } catch (e) {
      fail(e);
    } finally {
      setUploading(false);
    }
  };

  const picker = (
    <Menu
      label={tr("Choose a soundtrack")}
      trigger={() => (
        <span className="inline-flex items-center gap-1.5 rounded-md bg-raised px-3 py-1.5 text-[13px] text-ink">
          {uploading ? <LoaderCircle size={14} className="animate-spin" /> : <AudioLines size={14} />}
          {tr(track ? "Change" : "Choose a soundtrack")}
          <ChevronDown size={13} className="text-dim" />
        </span>
      )}
    >
      {(close) => (
        <>
          {audioTakes.map((j) => (
            <MenuItem
              key={j.id}
              onClick={() => {
                close();
                fromTake(j);
              }}
            >
              <span className="flex items-center gap-2">
                <AudioLines size={13} className="shrink-0 text-daylight" />
                <span className="max-w-[240px] truncate">{j.title}</span>
              </span>
            </MenuItem>
          ))}
          {!audioTakes.length && <p className="max-w-[260px] px-3 py-2 text-[12px] text-faint">{tr("No audio takes yet. Run a music or voice workflow, or upload a file.")}</p>}
          <MenuItem
            onClick={() => {
              close();
              file.current?.click();
            }}
          >
            <span className="flex items-center gap-2">
              <Upload size={13} className="shrink-0" />
              {tr("Upload an audio file…")}
            </span>
          </MenuItem>
        </>
      )}
    </Menu>
  );

  const input = (
    <input
      ref={file}
      type="file"
      accept="audio/*,video/*"
      className="hidden"
      onChange={(e) => {
        const f = e.target.files?.[0];
        e.target.value = "";
        if (f) void upload(f);
      }}
    />
  );

  if (!track) {
    return (
      <aside className="flex flex-col gap-3 rounded-md bg-panel p-4 text-[13px] text-dim">
        <p className="readout text-[13px] text-daylight">{tr("Soundtrack")}</p>
        <p>{tr("Lay music or narration under the whole film: an audio take from your library, or a file from this computer.")}</p>
        <div>{picker}</div>
        {input}
      </aside>
    );
  }

  const runs = track.seconds ? Math.max(0, track.seconds - track.start) : null;
  return (
    <aside className="flex flex-col gap-4 rounded-md bg-panel p-4">
      <div>
        <p className="readout text-[13px] text-daylight">{tr("Soundtrack")}</p>
        <p className="line-clamp-2 text-[14px]">{track.label}</p>
        {track.seconds ? (
          <p className="readout mt-1 text-[13px] text-faint">
            {timecode(track.seconds)}
            {runs !== null && runs < total - 0.05 && <span className="text-tungsten"> · {tr("ends {s} s before the film", { s: (total - runs).toFixed(1) })}</span>}
          </p>
        ) : null}
      </div>
      <label className="flex flex-col gap-1 text-[12px] text-dim">
        {tr("The film starts at (s) into it")}
        <input
          key={`${track.take ?? track.url}-${track.start}`}
          type="number"
          step={0.1}
          min={0}
          max={track.seconds}
          defaultValue={Number(track.start.toFixed(2))}
          onBlur={(e) => {
            const v = Math.max(0, Number(e.target.value) || 0);
            if (Math.abs(v - track.start) > 1e-3) onChange({ ...track, start: v });
          }}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          className="readout rounded-md bg-surround px-2 py-1 text-[14px] text-ink focus:outline-none"
        />
      </label>
      <div className="flex flex-col gap-1 text-[12px] text-dim">
        {tr("Mix")}
        <Segmented<Soundtrack["mix"]> label="Mix" size="sm" value={track.mix} onChange={(mix) => onChange({ ...track, mix })} options={MIXES} />
      </div>
      <Slider
        label="Volume"
        value={volume}
        min={0}
        max={1}
        step={0.05}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(v) => {
          setDraft(v);
          clearTimeout(pending.current);
          pending.current = setTimeout(() => {
            onChange({ ...track, volume: v });
            setDraft(null);
          }, 300);
        }}
      />
      <p className="text-[12px] text-faint">{tr("It fades out over the film's last second.")}</p>
      <div className="flex flex-wrap gap-2">
        {picker}
        <Button onClick={() => onChange(null)} className="text-tally">
          <Trash2 size={14} /> {tr("Remove")}
        </Button>
      </div>
      {input}
    </aside>
  );
}
