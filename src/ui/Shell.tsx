"use client";

import { GradeSheet } from "./grade/GradeSheet";
import clsx from "clsx";
import { Check, Cloud, Languages, LoaderCircle, Monitor, Settings } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { isLive } from "@/lib/jobs";
import { LOCALES, tr, useLocale, useLocaleSync } from "@/i18n";
import { useToasts } from "./api";
import { switchMode } from "./connection";
import { Menu, MenuItem } from "./Menu";
import { useLiveFeed } from "./liveFeed";
import { ProjectSwitcher } from "./ProjectMenu";
import { useLive } from "./state";
import { confirmDiscard } from "./unsaved";

const NAV = [
  { href: "/", label: "Studio", tone: "tungsten" },
  { href: "/image", label: "Image", tone: "tungsten" },
  { href: "/henshin", label: "Henshin", tone: "tungsten" },
  { href: "/sequence", label: "Sequence", tone: "tungsten" },
  { href: "/library", label: "Library", tone: "ink" },
  { href: "/assets", label: "Assets", tone: "tungsten" },
  { href: "/workflows", label: "Workflows", tone: "ink" },
] as const;

/** Local GPU or Comfy Cloud, one click apart. */
function ModeSwitch() {
  const mode = useLive((s) => s.status?.mode);
  const router = useRouter();
  const [busy, setBusy] = useState<"local" | "cloud" | null>(null);

  const go = async (to: "local" | "cloud") => {
    if (to === mode || busy) return;
    setBusy(to);
    await switchMode(to, router.push);
    setBusy(null);
  };

  if (!mode) return null;
  const options = [
    { id: "local" as const, label: "Local", icon: Monitor, title: "Run on your own ComfyUI and GPU" },
    { id: "cloud" as const, label: "Cloud", icon: Cloud, title: "Run on Comfy Cloud's GPUs" },
  ];
  return (
    <div role="radiogroup" aria-label={tr("Where NovaField runs")} className="flex items-center gap-0.5 rounded-full bg-panel p-1">
      {options.map((o) => {
        const Icon = busy === o.id ? LoaderCircle : o.icon;
        return (
          <button
            key={o.id}
            role="radio"
            aria-checked={mode === o.id}
            onClick={() => void go(o.id)}
            title={tr(o.title)}
            className={clsx(
              "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px] transition-colors",
              mode === o.id ? "bg-tungsten text-black" : "text-dim hover:bg-raised hover:text-ink",
            )}
          >
            <Icon size={13} className={busy === o.id ? "animate-spin" : undefined} />
            {tr(o.label)}
          </button>
        );
      })}
    </div>
  );
}

function ServerPill() {
  const status = useLive((s) => s.status);
  const jobs = useLive((s) => s.jobs);
  const mine = Object.values(jobs).filter(isLive);
  const rolling = mine.some((j) => j.status === "running");
  const others = Math.max(0, (status?.queue?.running ?? 0) + (status?.queue?.pending ?? 0) - mine.filter((j) => j.status !== "preparing").length);

  let dot = "bg-faint";
  let text = tr("Connecting…");
  if (status) {
    if (!status.online && !status.dryRun) {
      dot = "bg-faint";
      text = tr("ComfyUI offline");
    } else if (rolling) {
      dot = "bg-tally animate-pulse";
      text = mine.length > 1 ? tr("Rendering, {n} waiting", { n: mine.length - 1 }) : tr("Rendering");
    } else if (mine.length) {
      dot = "bg-tungsten";
      text = tr("Queued");
    } else if (others > 0) {
      dot = "bg-tungsten";
      text = others > 1 ? tr("Busy with {n} other jobs", { n: others }) : tr("Busy with 1 other job");
    } else {
      dot = "bg-ok";
      text = tr(status.dryRun && !status.online ? "Dry run" : "Ready");
    }
  }
  const gpu = status?.gpu;
  return (
    <Link
      href="/connection"
      className="flex items-center gap-3 rounded-full bg-panel py-1.5 pr-3.5 pl-3 transition-colors hover:bg-raised"
      title={status ? tr("{server}. Click to change the connection.", { server: status.url }) : undefined}
    >
      <span className={clsx("size-2 rounded-full", dot)} aria-hidden />
      <span className="text-[13px]">{text}</span>
      {status?.mode === "cloud" && <span className="readout hidden text-[13px] text-dim sm:inline">{tr("Comfy Cloud")}</span>}
      {gpu && (
        <span className="readout hidden text-[13px] text-dim sm:inline">
          {gpu.name.replace("NVIDIA GeForce ", "")}{" "}
          <span className="text-faint">{tr("{free}/{total} GB free", { free: Math.round(gpu.vramFree / 2 ** 30), total: Math.round(gpu.vramTotal / 2 ** 30) })}</span>
        </span>
      )}
      {status?.dryRun && <span className="rounded-full bg-raised px-2 text-2xs text-dim">{tr("dry run")}</span>}
    </Link>
  );
}

function Toasts() {
  const toasts = useToasts((s) => s.toasts);
  const drop = useToasts((s) => s.drop);
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-[min(380px,calc(100vw-32px))] flex-col gap-2" aria-live="polite">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.button
            key={t.id}
            layout
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, x: 24 }}
            onClick={() => drop(t.id)}
            className={clsx(
              "pointer-events-auto rounded-md border-l-[3px] bg-raised px-3.5 py-2.5 text-left text-[13px] whitespace-pre-line shadow-[0_8px_24px_rgba(0,0,0,0.35)]",
              t.tone === "error" ? "border-tally" : t.tone === "done" ? "border-ok" : "border-tungsten",
            )}
          >
            {t.text}
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  );
}

function LanguageMenu() {
  const locale = useLocale((s) => s.locale);
  const setLocale = useLocale((s) => s.setLocale);
  const current = LOCALES.find((l) => l.id === locale) ?? LOCALES[0];
  return (
    <Menu
      label={tr("Language")}
      align="right"
      className="min-w-[160px]"
      trigger={() => (
        <span className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-dim hover:bg-panel hover:text-ink">
          <Languages size={14} />
          <span className="hidden sm:inline">{current.short}</span>
        </span>
      )}
    >
      {(close) =>
        LOCALES.map((l) => (
          <MenuItem
            key={l.id}
            active={l.id === locale}
            onClick={() => {
              // A new language re-renders the page, so unsaved edits would go.
              if (l.id !== locale && confirmDiscard()) setLocale(l.id);
              close();
            }}
          >
            <span className="flex-1">{l.label}</span>
            {l.id === locale && <Check size={13} className="text-tungsten" />}
          </MenuItem>
        ))
      }
    </Menu>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  useLiveFeed();
  useLocaleSync();
  const locale = useLocale((s) => s.locale);
  const path = usePathname();
  return (
    <div className="flex min-h-dvh flex-col">
      <header
        className="sticky top-0 z-40 flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-line/60 bg-surround/95 px-4 py-2.5 backdrop-blur sm:px-6"
        // Leaving the page from the header asks first when an editor has unsaved changes.
        onClickCapture={(e) => {
          const a = (e.target as HTMLElement).closest("a[href]");
          if (a && a.getAttribute("href") !== path && !confirmDiscard()) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
      >
        <Link href="/" className="badge-type text-[19px] leading-none tracking-tight">
          Nova<span className="text-tungsten">Field</span>
        </Link>
        <ProjectSwitcher />
        {/* No scrolling here: the active underline hangs below the bar, and a scroller would clip it. */}
        <nav className="order-3 -mx-1 flex w-full flex-wrap gap-0 sm:order-none sm:w-auto sm:gap-1">
          {NAV.map((n) => {
            const active = n.href === "/" ? path === "/" : path.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                className={clsx(
                  "relative rounded-md px-1 py-1.5 text-[12.5px] transition-colors sm:px-3 sm:text-[14px]",
                  active ? "text-ink" : "text-dim hover:bg-panel hover:text-ink",
                )}
              >
                {tr(n.label)}
                {active && (
                  <motion.span
                    layoutId="nav-underline"
                    className={clsx(
                      "absolute inset-x-3 -bottom-[11px] h-[2px] rounded-full",
                      n.tone === "tungsten" ? "bg-tungsten" : "bg-ink",
                    )}
                  />
                )}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <Link
            href="/settings"
            title={tr("Settings")}
            aria-label={tr("Settings")}
            className={clsx("rounded-md p-1.5 text-dim hover:bg-panel hover:text-ink", path === "/settings" && "bg-panel text-ink")}
          >
            <Settings size={15} />
          </Link>
          <LanguageMenu />
          <ModeSwitch />
          <ServerPill />
        </div>
      </header>
      {/* A new language re-renders the page, so every string picks it up. */}
      <main key={locale} className="flex flex-1 flex-col">
        {children}
      </main>
      <GradeSheet />
      <Toasts />
    </div>
  );
}
