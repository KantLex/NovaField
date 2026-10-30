// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadDictionary, useLocale } from "@/i18n";
import { IconButton } from "./controls";

afterEach(async () => {
  cleanup();
  await act(() => useLocale.getState().setLocale("en"));
});

describe("IconButton", () => {
  it("names itself for screen readers and tooltips, and presses", () => {
    const onClick = vi.fn();
    render(
      <IconButton label="Undo" onClick={onClick}>
        <svg />
      </IconButton>,
    );
    const b = screen.getByRole("button", { name: "Undo" });
    expect(b.getAttribute("title")).toBe("Undo");
    fireEvent.click(b);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("speaks the reader's language", async () => {
    await loadDictionary("ja");
    const ja = (await import("@/i18n/locales/ja.json")).default as Record<string, string>;
    await act(() => useLocale.getState().setLocale("ja"));
    render(
      <IconButton label="Undo" onClick={() => {}}>
        <svg />
      </IconButton>,
    );
    expect(screen.getByRole("button", { name: ja["Undo"] })).toBeTruthy();
    expect(ja["Undo"]).not.toBe("Undo");
  });

  it("shows when a toggle is on", () => {
    render(
      <IconButton label="Loop" onClick={() => {}} active>
        <svg />
      </IconButton>,
    );
    expect(screen.getByRole("button").getAttribute("aria-pressed")).toBe("true");
  });
});
