// @vitest-environment happy-dom
// The Henshin side panel shows each mode's own settings, and its choices land in the shared state.

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FULL_CAPS } from "@/server/runner";
import { ModePanel, retime } from "./ModePanel";
import { useRecipes } from "@/ui/workflows/store";
import { useG, type Mode } from "./state";

const caps = { ...FULL_CAPS };

// The asset slots load the asset library; there is none here.
vi.stubGlobal("fetch", async () => Response.json([]));

beforeEach(() =>
  act(() => useG.getState().set({ mode: "recast", models: {}, audio: "original", shape: "rect", notes: "", style: "", replacePrompt: "", pathPrompt: "", h3Source: undefined, wanSource: undefined })),
);
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

  it("says plainly when the server can't run the chosen model, and what it needs", () => {
    act(() => useG.getState().set({ mode: "paths" }));
    render(<ModePanel caps={{ ...caps, wanMove: false }} />);
    expect(screen.getByText(/^Wan 2\.1 \+ WanMove is not installed on the server\. It needs: wan2\.1_i2v_480p_14B_fp16\.safetensors/)).toBeTruthy();
    expect(screen.getByRole("option", { name: "Wan 2.1 + WanMove · Not installed" })).toBeTruthy();
  });

  it("offers two recommended models per mode in a list, and remembers the choice for that mode", () => {
    show("restyle");
    const list = screen.getByRole("combobox", { name: "Model" }) as HTMLSelectElement;
    expect([...list.options].map((o) => o.textContent)).toEqual(["MiniMax H3", "Wan 2.1 VACE"]);
    expect(list.value).toBe("h3");
    expect(screen.getByText(/Free to reinterpret materials/)).toBeTruthy();
    // No clip yet: nothing to cut again, so it just switches.
    fireEvent.change(list, { target: { value: "vace" } });
    expect(useG.getState().models).toEqual({ restyle: "vace" });
    expect(list.value).toBe("vace");
    expect(screen.getByText(/Follows the clip's edges/)).toBeTruthy();
  });

  it("only offers new sound and quality where the model has them", () => {
    act(() => useG.getState().set({ audio: "generated" }));
    show("recast");
    expect(screen.getByRole("radio", { name: "New" })).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox", { name: "Model" }), { target: { value: "scail" } });
    expect(useG.getState().audio).toBe("original");
    expect(screen.queryByRole("radio", { name: "New" })).toBeNull();
    expect(screen.queryByText("Quality")).toBeNull();
  });
});

describe("imported workflows as Henshin models", () => {
  const field = (id: string, role: string) => ({ id, node: id.split(".")[0], input: id.split(".")[1], kind: role === "prompt" ? "text" : role, role, label: role, group: "", value: "", exposed: true, advanced: false });
  const recipe = (id: string, name: string, roles: string[], paid?: string[]) => ({ id, name, source: "", createdAt: 0, updatedAt: 0, fields: roles.map((r, i) => field(`${i}.x`, r)), output: "video", fps: 24, missing: [], warnings: [], paid });
  beforeEach(() =>
    act(() =>
      useRecipes.setState({
        loaded: true,
        list: [recipe("v2v", "My v2v", ["prompt", "video"]), recipe("api", "Cloud swap", ["prompt", "video", "image"], ["SomeApiNode"]), recipe("t2v", "Text only", ["prompt"])] as never,
      }),
    ),
  );
  afterEach(() => act(() => useRecipes.setState({ list: [], loaded: false })));

  it("lists the workflows that take the mode's footage, with where they run, and greys out the rest", () => {
    show("recast");
    expect(screen.getByRole("group", { name: "Your workflows" })).toBeTruthy();
    expect((screen.getByRole("option", { name: "Cloud swap · API" }) as HTMLOptionElement).disabled).toBe(false);
    // No picture input for the character, or no clip at all: shown, but not choosable.
    expect(screen.getByRole("group", { name: "Can't recast: needs a clip and a picture input" })).toBeTruthy();
    expect((screen.getByRole("option", { name: "My v2v" }) as HTMLOptionElement).disabled).toBe(true);
    expect((screen.getByRole("option", { name: "Text only" }) as HTMLOptionElement).disabled).toBe(true);
    cleanup();
    show("restyle");
    expect(screen.getByRole("option", { name: "My v2v · Local" })).toBeTruthy();
  });

  it("runs the mode through the chosen workflow and hides what it can't use", () => {
    show("restyle");
    fireEvent.change(screen.getByRole("combobox", { name: "Model" }), { target: { value: "wf:v2v" } });
    expect(useG.getState().models).toEqual({ restyle: "wf:v2v" });
    expect(screen.getByText(/Your workflow gets the clip, the style picture/)).toBeTruthy();
    expect(screen.queryByText("Film stock")).toBeNull();
    expect(screen.queryByText("Sound")).toBeNull();
  });

  it("links the chosen workflow to where it can be changed", () => {
    act(() => useG.getState().set({ models: { restyle: "wf:v2v" } }));
    show("restyle");
    expect(screen.getByRole("link", { name: "Edit graph" }).getAttribute("href")).toBe("/workflows?open=v2v&mode=graph");
    expect(screen.getByRole("link", { name: "Edit form" }).getAttribute("href")).toBe("/workflows?open=v2v&mode=customise");
    expect(screen.getByRole("link", { name: "Import or manage workflows" })).toBeTruthy();
  });
});

describe("retiming a box track to another cut of the clip", () => {
  const cut = (fps: number, frames: number, start: number) => ({ name: "c.mp4", kind: "video" as const, url: "", fps, frames, source: { url: "/o.mp4", duration: 20, start } });
  it("keeps each keyframe on the same moment at the new frame rate", () => {
    const keys = [0, 16, 40].map((f) => ({ f, x: 0.1, y: 0.1, w: 0.2, h: 0.2 }));
    expect(retime(keys, cut(16, 81, 3), cut(24, 124, 3)).map((k) => k.f)).toEqual([0, 24, 60]);
  });
  it("drops keyframes that fall outside the new cut", () => {
    const keys = [0, 100, 123].map((f) => ({ f, x: 0.1, y: 0.1, w: 0.2, h: 0.2 }));
    expect(retime(keys, cut(24, 124, 0), cut(16, 81, 0)).map((k) => k.f)).toEqual([0, 67]);
  });
});
