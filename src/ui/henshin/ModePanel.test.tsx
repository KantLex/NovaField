// @vitest-environment happy-dom
// The Henshin side panel shows each mode's own settings, and its choices land in the shared state.

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FULL_CAPS } from "@/server/runner";
import { ModePanel } from "./ModePanel";
import { useG, type Mode } from "./state";

const caps = { ...FULL_CAPS };

// The asset slots load the asset library; there is none here.
vi.stubGlobal("fetch", async () => Response.json([]));

beforeEach(() => act(() => useG.getState().set({ mode: "recast", audio: "original", shape: "rect", notes: "", style: "", replacePrompt: "", pathPrompt: "" })));
afterEach(cleanup);

const show = (mode: Mode) => {
  act(() => useG.getState().set({ mode }));
  return render(<ModePanel caps={caps} />);
};

describe("Henshin's panel", () => {
  it.each([
    ["recast", ["Your character", "Direction", "Sound", "Quality"]],
    ["restyle", ["New style", "Film stock"]],
    ["replace", ["Box shape", "It becomes"]],
    ["paths", ["What moves", "How it works"]],
  ] as [Mode, string[]][])("%s shows its own settings", (mode, headings) => {
    show(mode);
    for (const h of headings) expect(screen.getAllByText(h).length).toBeGreaterThan(0);
    if (mode !== "replace") expect(screen.queryByText("Box shape")).toBeNull();
    if (mode !== "recast") expect(screen.queryByText("Your character")).toBeNull();
  });

  it("writes what's typed and picked into the Henshin state", () => {
    show("recast");
    fireEvent.change(screen.getByPlaceholderText("e.g. keep the red umbrella, make it night"), { target: { value: "make it night" } });
    expect(useG.getState().notes).toBe("make it night");
    fireEvent.click(screen.getByRole("radio", { name: "Silent" }));
    expect(useG.getState().audio).toBe("none");
  });

  it("says plainly when the server can't do motion paths", () => {
    act(() => useG.getState().set({ mode: "paths" }));
    render(<ModePanel caps={{ ...caps, wanMove: false }} />);
    expect(screen.getByText("WanMove and Wan 2.1 image-to-video are not installed on the server.")).toBeTruthy();
  });
});
