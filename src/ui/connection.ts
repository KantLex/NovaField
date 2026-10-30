// Switching between a local ComfyUI and Comfy Cloud, and what went wrong when connecting, in words:
// shared by the Connection page, the header's switch and the node-pack notices.

import type { ConnectionProblem, ConnectionTest, PublicConnection } from "@/server/connection";
import { tr } from "@/i18n";
import { fail, request, toast } from "./api";
import { useLive, type ServerStatus } from "./state";

export const PROBLEMS: Record<ConnectionProblem, string> = {
  "no-key": "Paste your Comfy Cloud API key first.",
  offline: "Couldn't reach cloud.comfy.org. Check your internet connection.",
  "bad-key": "Comfy Cloud didn't accept this key. Copy it again from platform.comfy.org → API keys, and copy all of it.",
  "no-plan": "This account can't use the Comfy Cloud API yet. It needs a Creator or Pro plan.",
  "cloud-error": "Comfy Cloud didn't answer properly. Try again in a moment.",
  waitlisted: "This account is still on the Comfy Cloud waitlist.",
  "no-comfy": "No ComfyUI answered at this address. Is it running, and started with --listen if it's on another computer?",
};

/** Event the Connection page listens for: which tab to show. */
export const SHOW_MODE = "novafield:show-mode";

/**
 * Switch where NovaField runs. A switch the server can't make yet (no Cloud key, a ComfyUI that
 * doesn't answer) opens the Connection page on that side via `go`, saying why.
 */
export async function switchMode(to: "local" | "cloud", navigate: (href: string) => void) {
  // Already on the Connection page, a new ?mode= doesn't remount it: tell the page directly too.
  const go = (href: string) => {
    navigate(href);
    window.dispatchEvent(new CustomEvent(SHOW_MODE, { detail: to }));
  };
  try {
    const saved = await request<PublicConnection>("/api/connection");
    if (to === "cloud" && !saved.cloudKey) return go("/connection?mode=cloud");
    const body = await request<{ connection?: PublicConnection; test?: ConnectionTest }>("/api/connection", { method: "PUT", json: { mode: to, ifWorks: true } });
    if (!body.connection) {
      toast(body.test?.problem ? tr(PROBLEMS[body.test.problem]) : tr("That connection didn't answer."), "error");
      return go(`/connection?mode=${to}`);
    }
    toast(to === "cloud" ? "Switched to Comfy Cloud." : "Switched to your local ComfyUI.", "done");
    // Show the new side now rather than at the next status check.
    useLive.getState().setStatus(await request<ServerStatus>("/api/status"));
  } catch (e) {
    fail(e);
  }
}
