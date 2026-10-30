// @vitest-environment happy-dom
// Undo and redo as the Sequence editor uses them: the edit is saved state, and each change commits.

import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { useHistory } from "./useHistory";

function useEdit(initial: string[], limit?: number) {
  const [saved, save] = useState(initial);
  const history = useHistory(saved, save, limit);
  return { saved, ...history };
}

describe("useHistory", () => {
  it("undoes and redoes commits in order", () => {
    const { result } = renderHook(() => useEdit(["a"]));
    act(() => result.current.commit(["a", "b"]));
    act(() => result.current.commit(["a", "b", "c"]));
    expect(result.current.saved).toEqual(["a", "b", "c"]);
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);

    act(() => void result.current.undo());
    expect(result.current.saved).toEqual(["a", "b"]);
    act(() => void result.current.undo());
    expect(result.current.saved).toEqual(["a"]);
    expect(result.current.canUndo).toBe(false);

    act(() => void result.current.redo());
    expect(result.current.saved).toEqual(["a", "b"]);
    expect(result.current.canRedo).toBe(true);
  });

  it("drops the redo trail when something new is committed", () => {
    const { result } = renderHook(() => useEdit(["a"]));
    act(() => result.current.commit(["b"]));
    act(() => void result.current.undo());
    act(() => result.current.commit(["c"]));
    expect(result.current.canRedo).toBe(false);
    let redone = true;
    act(() => void (redone = result.current.redo()));
    expect(redone).toBe(false);
    expect(result.current.saved).toEqual(["c"]);
  });

  it("keeps only the last `limit` steps", () => {
    const { result } = renderHook(() => useEdit(["0"], 2));
    for (const v of ["1", "2", "3"]) act(() => result.current.commit([v]));
    act(() => void result.current.undo());
    act(() => void result.current.undo());
    expect(result.current.saved).toEqual(["1"]);
    let undone = true;
    act(() => void (undone = result.current.undo()));
    expect(undone).toBe(false);
  });

  it("starts over when the scope changes, so an undo can't reach into another project", () => {
    const { result, rerender } = renderHook(({ scope }) => {
      const [saved, save] = useState(["a"]);
      return { saved, ...useHistory(saved, save, 100, scope) };
    }, { initialProps: { scope: "A" } });
    act(() => result.current.commit(["a", "b"]));
    expect(result.current.canUndo).toBe(true);
    rerender({ scope: "B" });
    expect(result.current.canUndo).toBe(false);
    expect(result.current.undo()).toBe(false);
  });
});
