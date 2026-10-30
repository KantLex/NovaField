// @vitest-environment happy-dom

import { cleanup, render, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isTyping, useHotkeys } from "./hotkeys";

afterEach(cleanup);

const press = (target: EventTarget, key: string) => target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));

describe("useHotkeys", () => {
  it("sees keys pressed on the page", () => {
    const handler = vi.fn();
    renderHook(() => useHotkeys(handler));
    press(window, "z");
    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0][0].key).toBe("z");
  });

  it("leaves keys typed into text fields alone", () => {
    const handler = vi.fn();
    renderHook(() => useHotkeys(handler));
    const { getByRole } = render(
      <div>
        <input aria-label="name" />
        <textarea aria-label="notes" />
      </div>,
    );
    press(getByRole("textbox", { name: "name" }), "z");
    press(getByRole("textbox", { name: "notes" }), " ");
    expect(handler).not.toHaveBeenCalled();
  });

  it("takes Space from a focused button so it doesn't press it again", () => {
    const handler = vi.fn((e: KeyboardEvent) => e.preventDefault());
    renderHook(() => useHotkeys(handler));
    const { getByRole } = render(<button>Play</button>);
    const button = getByRole("button");
    button.focus();
    press(button, " ");
    expect(handler).toHaveBeenCalledOnce();
    expect(document.activeElement).not.toBe(button);
  });

  it("leaves a Space the page doesn't use to the button", () => {
    renderHook(() => useHotkeys(() => {}));
    const { getByRole } = render(<button>Save</button>);
    const button = getByRole("button");
    button.focus();
    press(button, " ");
    expect(document.activeElement).toBe(button);
  });

  it("is quiet while a modal is open over the page", () => {
    const handler = vi.fn();
    renderHook(() => useHotkeys(handler));
    const { getByRole } = render(
      <div role="dialog" aria-modal="true">
        <button>Close</button>
      </div>,
    );
    press(window, "z");
    expect(handler).not.toHaveBeenCalled();
    press(getByRole("button"), "z");
    expect(handler).toHaveBeenCalledOnce();
  });

  it("stops listening when the component goes away", () => {
    const handler = vi.fn();
    const { unmount } = renderHook(() => useHotkeys(handler));
    unmount();
    press(window, "z");
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("isTyping", () => {
  it("knows text fields from everything else", () => {
    const { container } = render(
      <div>
        <select aria-label="pick" />
        <div contentEditable suppressContentEditableWarning>
          <span>inside</span>
        </div>
        <div contentEditable={false}>
          <span>off</span>
        </div>
      </div>,
    );
    expect(isTyping(container.querySelector("select"))).toBe(true);
    expect(isTyping(container.querySelector("[contenteditable='true'] span"))).toBe(true);
    expect(isTyping(container.querySelector("[contenteditable='false'] span"))).toBe(false);
    expect(isTyping(null)).toBe(false);
  });
});
