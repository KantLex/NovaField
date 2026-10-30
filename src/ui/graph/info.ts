"use client";

import { useEffect, useState } from "react";
import type { ObjectInfo } from "@/lib/comfy/validate";
import { ApiError, request } from "../api";

let cache: Promise<ObjectInfo> | null = null;
let fresh = false;

/** After installing node packs and restarting ComfyUI: the next editor loads the new node list. */
export function forgetObjectInfo() {
  cache = null;
  // Past the browser's own short cache of the old list too.
  fresh = true;
}

/** The server's node list, fetched once per page (it is large) and shared by every editor. */
export function useObjectInfo(): { info: ObjectInfo | null; error: string | null } {
  const [info, setInfo] = useState<ObjectInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    cache ??= request<ObjectInfo>(fresh ? `/api/comfy/object-info?at=${Date.now()}` : "/api/comfy/object-info").catch((e: unknown) => {
      // Ask again next time rather than keep the failure.
      cache = null;
      throw e instanceof ApiError && !e.body.error ? new Error("ComfyUI didn't send its node list.") : e;
    });
    cache.then(setInfo, (e: Error) => setError(e.message));
  }, []);
  return { info, error };
}

/** Wire and socket colours by type, tuned for the dark canvas. */
const TYPE_COLORS: Record<string, string> = {
  MODEL: "#b39ddb",
  CLIP: "#ffd166",
  VAE: "#ef8b8b",
  LATENT: "#f4a6d7",
  IMAGE: "#7fc8f8",
  MASK: "#9be39b",
  CONDITIONING: "#ffb46b",
  AUDIO: "#5ee0c8",
  VIDEO: "#6fd3ff",
  CLIP_VISION: "#e6d36b",
  CLIP_VISION_OUTPUT: "#e6d36b",
  CONTROL_NET: "#7be0a8",
  SAMPLER: "#c7c7ff",
  SIGMAS: "#c7c7ff",
  NOISE: "#c7c7ff",
  GUIDER: "#c7c7ff",
};

export function typeColor(type: string): string {
  if (TYPE_COLORS[type]) return TYPE_COLORS[type];
  if (["INT", "FLOAT", "STRING", "BOOLEAN", "ENUM", "COMBO"].includes(type)) return "#a3a39a";
  // Anything else gets a stable hue of its own.
  let h = 0;
  for (const c of type) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h} 55% 68%)`;
}
