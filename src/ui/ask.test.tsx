// @vitest-environment happy-dom
// The app's own questions: they answer only when the person does, unlike confirm() in embedded browsers.

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ask, AskHost, askText } from "./ask";

afterEach(cleanup);

describe("asking before going ahead", () => {
  it("waits for the person, and goes ahead only when they agree", async () => {
    render(<AskHost />);
    let answer: Promise<boolean>;
    act(() => void (answer = ask("Remove “Fox”?", { ok: "Remove", danger: true })));
    expect(screen.getByRole("alertdialog", { name: "Remove “Fox”?" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await expect(answer!).resolves.toBe(true);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("takes Cancel, Escape and a click outside as no", async () => {
    const { container } = render(<AskHost />);
    for (const say of [() => fireEvent.click(screen.getByRole("button", { name: "Cancel" })), () => fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" }), () => fireEvent.mouseDown(container.querySelector(".fixed")!)]) {
      let answer: Promise<boolean>;
      act(() => void (answer = ask("Delete it?")));
      act(say);
      await expect(answer!).resolves.toBe(false);
    }
  });

  it("asks for a name, starting from the old one", async () => {
    render(<AskHost />);
    let answer: Promise<string | null>;
    act(() => void (answer = askText("Name this take", "Shot 1", { ok: "Rename" })));
    const input = screen.getByRole("textbox", { name: "Name this take" }) as HTMLInputElement;
    expect(input.value).toBe("Shot 1");
    fireEvent.change(input, { target: { value: "Rooftop" } });
    fireEvent.submit(input.form!);
    await expect(answer!).resolves.toBe("Rooftop");
  });
});
