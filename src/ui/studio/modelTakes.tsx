"use client";

// Finished 3D takes, newest first: what can stand in the 3D plan as a set piece or a person.

import { Box } from "lucide-react";
import { useMemo } from "react";
import { isAppFile } from "@/lib/cinema/camera";
import { useLive } from "../state";

export interface ModelTake {
  id: string;
  title: string;
  model: string;
  poster?: string;
}

export function useModelTakes(): ModelTake[] {
  const jobs = useLive((s) => s.jobs);
  return useMemo(
    () =>
      Object.values(jobs)
        .filter((j) => j.status === "done" && j.model && isAppFile(j.model))
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((j) => ({ id: j.id, title: j.title, model: j.model!, poster: j.poster })),
    [jobs],
  );
}


/** A 3D take's still, or a box when it has none yet. */
export function ModelThumb({ take }: { take: ModelTake }) {
  return take.poster ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={take.poster} alt="" className="size-6 flex-none rounded-sm object-cover" />
  ) : (
    <span className="flex size-6 flex-none items-center justify-center rounded-sm bg-white/10">
      <Box size={13} className="text-faint" />
    </span>
  );
}
