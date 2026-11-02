"use client";

// Questions the app asks before something that can't be undone, in its own dialog. The browser's
// confirm() and prompt() are switched off in some embedded browsers, where they answer "no" at
// once without showing anything, so a delete button would seem to do nothing.

import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { tr } from "@/i18n";
import { Button } from "./controls";

interface Question {
  message: string;
  /** The button that goes ahead (default "OK"). */
  ok: string;
  /** Going ahead deletes or throws something away. */
  danger: boolean;
  /** Asks for a line of text, starting from this. */
  text?: string;
  answer: (v: boolean | string | null) => void;
}

const useAsk = create<{ q: Question | null }>(() => ({ q: null }));

function open(q: Omit<Question, "answer">): Promise<boolean | string | null> {
  return new Promise((answer) => {
    // A new question replaces one still open, which counts as cancelled.
    useAsk.getState().q?.answer(q.text !== undefined ? null : false);
    useAsk.setState({ q: { ...q, answer } });
  });
}

/** Ask before going ahead; true when the person agrees. `ok` is English and translated here. */
export const ask = (message: string, o: { ok?: string; danger?: boolean } = {}) =>
  open({ message, ok: tr(o.ok ?? "OK"), danger: !!o.danger }) as Promise<boolean>;

/** Ask for a line of text, starting from `value`; null when cancelled. */
export const askText = (message: string, value: string, o: { ok?: string } = {}) =>
  open({ message, ok: tr(o.ok ?? "OK"), danger: false, text: value }) as Promise<string | null>;

/** Where the questions show: mounted once, in the shell. */
export function AskHost() {
  const q = useAsk((s) => s.q);
  if (!q) return null;
  // A fresh dialog (and its text) for every question.
  return <Dialog key={`${q.message}|${q.text ?? ""}`} q={q} />;
}

function Dialog({ q }: { q: Question }) {
  const [text, setText] = useState(q.text ?? "");
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const done = (v: boolean | string | null) => {
    useAsk.setState({ q: null });
    q.answer(v);
  };
  const cancel = () => done(q.text !== undefined ? null : false);
  const go = () => done(q.text !== undefined ? text : true);

  useEffect(() => {
    if (q.text !== undefined) inputRef.current?.select();
    else formRef.current?.querySelector<HTMLButtonElement>("button[type=submit]")?.focus();
  }, [q.text]);

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4 backdrop-blur-[2px]"
      onMouseDown={(e) => e.target === e.currentTarget && cancel()}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          cancel();
        }
      }}
    >
      <form
        ref={formRef}
        role="alertdialog"
        aria-modal="true"
        aria-label={q.message}
        onSubmit={(e) => {
          e.preventDefault();
          go();
        }}
        className="flex w-[min(420px,100%)] flex-col gap-4 rounded-md bg-panel p-5 shadow-[0_16px_48px_rgba(0,0,0,0.6)]"
      >
        <p className="text-[14px] leading-relaxed text-ink">{q.message}</p>
        {q.text !== undefined && (
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-label={q.message}
            className="rounded-md bg-surround px-3 py-2 text-[14px] focus:outline-none"
          />
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" onClick={cancel}>
            {tr("Cancel")}
          </Button>
          <Button type="submit" variant={q.danger ? "danger" : "solid"}>
            {q.ok}
          </Button>
        </div>
      </form>
    </div>
  );
}
