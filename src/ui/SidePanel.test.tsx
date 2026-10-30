// @vitest-environment happy-dom
// Side panels fold to a rail and back, by their handle or by [ and ], and stay as they were left.

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { columnWidth, RAIL, SidePanel, usePanelKeys, usePanelOpen, usePanels } from "./SidePanel";

function Page() {
  usePanelKeys({ left: "t-left", right: "t-right" });
  const left = usePanelOpen("t-left");
  return (
    <div data-width={columnWidth(left, "256px")}>
      <SidePanel id="t-left" side="left" label="Cast">
        <p>cast list</p>
      </SidePanel>
      <SidePanel id="t-right" side="right" label="Director">
        <p>director controls</p>
      </SidePanel>
      <input aria-label="script" />
    </div>
  );
}

beforeEach(() => act(() => usePanels.setState({ closed: {} })));
afterEach(cleanup);

describe("side panels", () => {
  it("fold to a rail with the panel's name and open again", () => {
    const { container } = render(<Page />);
    fireEvent.click(screen.getByRole("button", { name: "Hide Cast" }));
    expect(screen.queryByText("cast list")).toBeNull();
    expect((container.firstChild as HTMLElement).dataset.width).toBe(RAIL);
    const rail = screen.getByRole("button", { name: /Cast/ });
    expect(rail.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(rail);
    expect(screen.getByText("cast list")).toBeTruthy();
    expect((container.firstChild as HTMLElement).dataset.width).toBe("256px");
  });

  it("fold from the keyboard, but not while typing", () => {
    render(<Page />);
    fireEvent.keyDown(window, { key: "]" });
    expect(screen.queryByText("director controls")).toBeNull();
    fireEvent.keyDown(window, { key: "[" });
    expect(screen.queryByText("cast list")).toBeNull();
    fireEvent.keyDown(screen.getByRole("textbox", { name: "script" }), { key: "[" });
    expect(screen.queryByText("cast list")).toBeNull();
    expect(usePanels.getState().closed).toEqual({ "t-left": true, "t-right": true });
  });
});
