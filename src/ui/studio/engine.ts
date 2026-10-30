"use client";

import { useStudio } from "../state";
import { useRecipes } from "../workflows/store";

/** What the Studio's current engine makes: MiniMax H3 makes video; a workflow makes whatever it outputs. */
export function useEngineOutput(): "video" | "image" | "audio" {
  const engine = useStudio((s) => s.shot.engine);
  const out = useRecipes((s) => (engine ? s.list.find((r) => r.id === engine)?.output : undefined));
  return out === "image" || out === "audio" ? out : "video";
}
