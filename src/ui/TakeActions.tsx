"use client";

import clsx from "clsx";
import { BookmarkPlus, ChevronDown, ChevronLeft, ChevronRight, Clapperboard, Download, Ellipsis, FastForward, Film, FolderInput, ImageDown, ImageUpscale, ListPlus, Pencil, Play, Repeat, Replace, Sparkles, Star, Trash2, UserRound, Wand2, Workflow, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { isLive, type Job } from "@/lib/jobs";
import { api, fail, request, toast } from "./api";
import { SaveToAssets, SaveToAssetsPanel, type SaveChoice } from "./assets/SaveToAssets";
import { Menu, MenuItem } from "./Menu";
import { useGrade } from "./grade/GradeSheet";
import { openInLab, runTool } from "./image/state";
import { MoveToProject, MoveToProjectPanel } from "./ProjectMenu";
import { QcMenu } from "./Qc";
import { usePulse } from "./pulse";
import { reuse, reuseTarget } from "./reuse";
import { PICTURE_TARGETS, sendClip, sendTakePicture, sendToEdit } from "./sendTo";
import { tr } from "@/i18n";
import { useStudio } from "./state";

/** The star, with a small pop when it changes (not when the card first appears). */
function StarIcon({ on }: { on: boolean }) {
  const ref = usePulse<HTMLSpanElement>(on, "nf-star");
  return (
    <span ref={ref} className="flex">
      <Star size={14} className={on ? "fill-tungsten text-tungsten" : ""} />
    </span>
  );
}

/** The take's file (clip, picture or sound) and a file name from its title, for the download button. */
export function takeFile(job: Job): { url: string; name: string } | null {
  const url = job.video ?? job.image ?? job.audio;
  if (job.status !== "done" || !url) return null;
  const ext = url.match(/\.\w+$/)?.[0] ?? "";
  const base = job.title.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 60).toLowerCase() || job.id;
  return { url, name: `${base}${ext}` };
}

export const canEditAsWorkflow = (job: Job) => !!job.meta && job.kind !== "workflow";

/** Turn a take's ComfyUI graph into a workflow and open it in graph mode. */
export async function editAsWorkflow(job: Job, go: (href: string) => void) {
  try {
    const j = await request<{ id: string }>("/api/workflows/from-take", { json: { id: job.id } });
    toast("The take's graph is now a workflow. Edit it, then run it from its form.", "done");
    go(`/workflows?open=${j.id}&mode=graph`);
  } catch (e) {
    fail(e);
  }
}

/**
 * - next: the likely next steps, as labelled buttons in viewers and icons on cards;
 * - use: where the take's picture or clip can go ("Use as…");
 * - more: housekeeping, out of the way;
 * - bar: always an icon in the row (delete), like the star and download.
 */
type Action = { id: string; label: string; short?: string; icon: React.ReactNode; run: () => unknown; show: boolean; group: "next" | "use" | "more" | "bar"; danger?: boolean };

/** Everything you can do with a take: as an overlay on cards, or inline in viewers. `without` leaves actions out by id. */
/** On a thumbnail, the next steps that stay icons (the first two of these the take has); the rest go under More. */
const CARD_NEXT = ["animate", "continue", "reuse", "restyle", "edit", "grade", "lab", "upscale"];

export function TakeActions({ job, inline = false, without = [] }: { job: Job; inline?: boolean; without?: string[] }) {
  const live = isLive(job);
  const done = job.status === "done";
  const router = useRouter();
  const go = (href: string) => router.push(href);
  const picture = done && !job.video && !!job.image;
  const clip = done && !!job.video;
  // A take can become an asset: the clip itself, or its still (to cast a generated character).
  const saveChoices: SaveChoice[] = done
    ? [
        ...(job.video ? [{ url: job.video, label: tr("The clip") }] : []),
        ...(job.image ? [{ url: job.image, label: tr("The image") }] : []),
        ...(job.video && job.poster ? [{ url: job.poster, label: tr("A still") }] : []),
        ...(job.audio && !job.video ? [{ url: job.audio, label: tr("The audio") }] : []),
      ]
    : [];

  const all: Action[] = [
    {
      id: "animate",
      label: "Animate this picture",
      short: tr("Animate"),
      icon: <Play size={14} />,
      show: picture,
      group: "next",
      run: () => sendTakePicture(job, "first", go),
    },
    {
      id: "continue",
      label: "Continue this shot",
      short: tr("Continue"),
      icon: <FastForward size={14} />,
      show: clip && job.kind === "shot" && !(job.spec.kind === "shot" && job.spec.engine),
      group: "next",
      run: () => {
        if (job.spec.kind !== "shot") return;
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { kind, seed, extend, ...rest } = job.spec;
        useStudio.getState().patch({ ...rest, prompt: "", startFrame: undefined, endFrame: undefined, extendFrom: job.id });
        toast("Write what happens next. The new take picks up from the last second of this one.");
        if (window.location.pathname !== "/") go("/");
      },
    },
    { id: "lab", label: "Edit this picture", short: tr("Edit"), icon: <Wand2 size={14} />, show: picture, group: "next", run: () => openInLab(job, go) },
    { id: "upscale", label: "Upscale ×2", short: tr("Upscale"), icon: <ImageUpscale size={14} />, show: picture, group: "next", run: () => runTool(job, "upscale", go, { scale: 2 }) },
    { id: "restyle", label: "Restyle in Henshin", short: tr("Restyle"), icon: <Sparkles size={14} />, show: clip, group: "next", run: () => sendClip(job, "restyle", go) },
    { id: "grade", label: "Grade the film look", short: tr("Grade"), icon: <Film size={14} />, show: clip, group: "next", run: () => useGrade.getState().open(job.id) },
    { id: "edit", label: "Add to the edit", short: tr("Add to edit"), icon: <ListPlus size={14} />, show: clip, group: "next", run: () => sendToEdit(job) },
    {
      id: "reuse",
      label: "Reuse prompt and references",
      short: tr("Reuse"),
      icon: <Repeat size={14} />,
      show: !!reuseTarget(job),
      group: "next",
      run: () => {
        const to = reuse(job);
        if (to && to !== window.location.pathname + window.location.search) go(to);
      },
    },
    ...PICTURE_TARGETS.map(
      // A picture's own Edit button opens it on the Image page, so it isn't offered twice.
      (t): Action => ({ id: `use-${t.id}`, label: t.label, icon: <ImageDown size={14} />, show: picture && t.id !== "lab", group: "use", run: () => sendTakePicture(job, t.id, go) }),
    ),
    { id: "use-last", label: "Use last frame as first frame", icon: <ImageDown size={14} />, show: clip, group: "use", run: () => sendTakePicture(job, "first", go) },
    { id: "lab-last", label: "Edit the last frame as a picture", icon: <Wand2 size={14} />, show: clip, group: "use", run: () => sendTakePicture(job, "lab", go) },
    { id: "previs", label: "Use as previs for the next shot", icon: <Clapperboard size={14} />, show: clip, group: "use", run: () => sendClip(job, "previs", go) },
    { id: "recast", label: "Recast in Henshin", icon: <UserRound size={14} />, show: clip, group: "use", run: () => sendClip(job, "recast", go) },
    { id: "replace", label: "Replace an object in Henshin", icon: <Replace size={14} />, show: clip, group: "use", run: () => sendClip(job, "replace", go) },
    {
      id: "rename",
      label: "Rename",
      icon: <Pencil size={14} />,
      show: true,
      group: "more",
      run: () => {
        const name = window.prompt(tr("Name this take"), job.title)?.replace(/\s+/g, " ").trim();
        if (name && name !== job.title) return api.rename(job.id, name).catch(fail);
      },
    },
    { id: "graph", label: "Edit as workflow (graph mode)", icon: <Workflow size={14} />, show: canEditAsWorkflow(job), group: "more", run: () => editAsWorkflow(job, go) },
    { id: "graph-file", label: "Download ComfyUI graph", icon: <Download size={14} />, show: !!job.meta, group: "more", run: () => void window.open(`/api/jobs/${job.id}/graph`) },
    { id: "delete", label: "Delete take", icon: <Trash2 size={14} />, show: !live, group: "bar", danger: true, run: () => api.remove(job.id).catch(fail) },
  ];
  const file = takeFile(job);
  const shown = all.filter((a) => a.show && !without.includes(a.id));
  const next = shown.filter((a) => a.group === "next");
  const use = shown.filter((a) => a.group === "use");
  const more = shown.filter((a) => a.group === "more");
  const bar = shown.filter((a) => a.group === "bar");
  // Thumbnails are small: two next steps as icons, the rest (and project, assets) under More.
  const cardNext = [...next].sort((a, b) => CARD_NEXT.indexOf(a.id) - CARD_NEXT.indexOf(b.id)).slice(0, 2);
  const nextHere = inline ? next : cardNext;
  const menuUse = inline ? [] : [...next.filter((a) => !cardNext.includes(a)), ...use];
  const canMove = !live;

  const items = (list: Action[], close: () => void) =>
    list.map((a) => (
      <MenuItem
        key={a.id}
        danger={a.danger}
        onClick={() => {
          close();
          void a.run();
        }}
      >
        <span className="shrink-0">{a.icon}</span>
        <span className="min-w-0 flex-1">{tr(a.label)}</span>
      </MenuItem>
    ));
  const iconButton = "rounded p-1 text-ink hover:bg-white/15";

  return (
    <div
      className={clsx(
        "flex items-center gap-0.5",
        inline && "flex-wrap gap-y-1.5",
        // On a card the row wraps rather than spilling past a narrow thumbnail.
        !inline &&
          "absolute right-1 bottom-1 max-w-[calc(100%-8px)] flex-wrap justify-end rounded-md bg-black/75 p-0.5 opacity-0 backdrop-blur transition-opacity group-hover:opacity-100 focus-within:opacity-100",
      )}
    >
      {nextHere.map((a) =>
        inline ? (
          <button
            key={a.id}
            onClick={() => void a.run()}
            title={tr(a.label)}
            className="mr-1 flex items-center gap-1.5 rounded-md bg-raised px-2.5 py-1 text-[13px] text-ink hover:bg-hover"
          >
            {a.icon}
            {a.short}
          </button>
        ) : (
          <button
            key={a.id}
            onClick={(e) => {
              e.stopPropagation();
              void a.run();
            }}
            title={tr(a.label)}
            aria-label={tr(a.label)}
            className={iconButton}
          >
            {a.icon}
          </button>
        ),
      )}
      {inline && <QcMenu job={job} />}
      {inline && use.length > 0 && (
        <Menu
          label={tr("Use as")}
          trigger={(open) => (
            <span className="mr-1 flex items-center gap-1 rounded-md bg-raised px-2.5 py-1 text-[13px] text-ink hover:bg-hover">
              {tr("Use as")}
              <ChevronDown size={13} className={open ? "rotate-180 transition-transform" : "transition-transform"} />
            </span>
          )}
        >
          {(close) => items(use, close)}
        </Menu>
      )}
      {inline && <span className="flex-1" />}
      {live && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            api.cancel(job.id).then(() => toast("Cancelled."), fail);
          }}
          title={tr("Cancel render")}
          aria-label={tr("Cancel render")}
          className={iconButton}
        >
          <X size={14} />
        </button>
      )}
      {done && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            api.favorite(job.id, !job.favorite).catch(fail);
          }}
          title={tr(job.favorite ? "Unstar" : "Star")}
          aria-label={tr(job.favorite ? "Unstar" : "Star")}
          className={iconButton}
        >
          <StarIcon on={!!job.favorite} />
        </button>
      )}
      {file && (
        <a
          href={file.url}
          download={file.name}
          onClick={(e) => e.stopPropagation()}
          title={tr("Download")}
          aria-label={tr("Download")}
          className={iconButton}
        >
          <Download size={14} />
        </a>
      )}
      {inline && canMove && <MoveToProject ids={[job.id]} currentProject={job.project} compact />}
      {inline && saveChoices.length > 0 && <SaveToAssets choices={saveChoices} compact suggestedKind={job.video ? "clip" : "character"} />}
      {bar.map((a) => (
        <button
          key={a.id}
          onClick={(e) => {
            e.stopPropagation();
            void a.run();
          }}
          title={tr(a.label)}
          aria-label={tr(a.label)}
          className={a.danger ? "rounded p-1 text-tally hover:bg-white/15" : iconButton}
        >
          {a.icon}
        </button>
      ))}
      {(menuUse.length > 0 || more.length > 0 || (!inline && (canMove || saveChoices.length > 0))) && (
        <Menu
          label={tr("More")}
          align="right"
          trigger={() => (
            <span className={iconButton}>
              <Ellipsis size={14} />
            </span>
          )}
        >
          {(close) =>
            inline ? (
              items(more, close)
            ) : (
              <CardMore
                job={job}
                close={close}
                top={items(menuUse, close)}
                bottom={items(more, close)}
                canMove={canMove}
                saveChoices={saveChoices}
              />
            )
          }
        </Menu>
      )}
    </div>
  );
}

/** A thumbnail's More menu: the steps that aren't icons, then project and assets, which open in place. */
function CardMore({
  job,
  close,
  top,
  bottom,
  canMove,
  saveChoices,
}: {
  job: Job;
  close: () => void;
  top: React.ReactNode[];
  bottom: React.ReactNode[];
  canMove: boolean;
  saveChoices: SaveChoice[];
}) {
  // A menu opened from inside this one would close with it, so these swap in here instead.
  const [view, setView] = useState<"main" | "project" | "assets">("main");
  if (view !== "main")
    return (
      <div className="flex w-[268px] flex-col">
        <button onClick={() => setView("main")} className="flex items-center gap-1 rounded px-1.5 py-1 text-left text-[12px] text-dim hover:text-ink">
          <ChevronLeft size={14} />
          {tr(view === "project" ? "Move to project" : "Save to assets")}
        </button>
        {view === "project" ? (
          <MoveToProjectPanel ids={[job.id]} currentProject={job.project} close={close} />
        ) : (
          <SaveToAssetsPanel choices={saveChoices} suggestedKind={job.video ? "clip" : "character"} close={close} />
        )}
      </div>
    );
  const opener = (to: "project" | "assets", icon: React.ReactNode, label: string) => (
    <MenuItem onClick={() => setView(to)}>
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0 flex-1">{tr(label)}</span>
      <ChevronRight size={14} className="text-faint" />
    </MenuItem>
  );
  return (
    <>
      {top}
      {top.length > 0 && <div className="my-1 border-t border-line" />}
      {canMove && opener("project", <FolderInput size={14} />, "Move to project")}
      {saveChoices.length > 0 && opener("assets", <BookmarkPlus size={14} />, "Save to assets")}
      {bottom}
    </>
  );
}
