import { NextResponse, type NextRequest } from "next/server";

// The app has no accounts: anyone who can reach it can render, upload and install node packs. So it
// listens on this computer only (pnpm dev), and here:
// - every request must be addressed to this computer by name or IP. A web page that points its own
//   domain at 127.0.0.1 (DNS rebinding) is refused, reads included. With NOVAFIELD_LAN=1
//   (pnpm dev:lan) any IP address is fine too, and names listed in NOVAFIELD_ALLOWED_HOSTS;
// - changes are only taken from the app's own pages (or from tools like the CLI, which send no
//   Origin), so another site open in the same browser can't make them. Reads stay open.
const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

export function proxy(request: NextRequest) {
  if (!allowedHost(request.headers.get("host"))) return refuse("NovaField only answers at this computer's own address (localhost).");
  if (SAFE.has(request.method)) return;
  if (request.headers.get("sec-fetch-site") === "cross-site") return refuse();
  const origin = request.headers.get("origin");
  if (origin && origin !== "null") {
    let host: string;
    try {
      host = new URL(origin).host;
    } catch {
      return refuse();
    }
    if (host !== request.headers.get("host")) return refuse();
  } else if (origin === "null") return refuse();
}

/** The Host a request was sent to: this computer, or (opted in) an address on the network. */
export function allowedHost(host: string | null, env: Record<string, string | undefined> = process.env): boolean {
  if (!host) return false;
  let name: string;
  try {
    name = new URL(`http://${host}`).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (name === "localhost" || name.endsWith(".localhost") || name === "[::1]" || /^127(\.\d{1,3}){3}$/.test(name)) return true;
  if (env.NOVAFIELD_LAN !== "1") return false;
  // An IP address can't be a rebinding trick: that needs a domain name the attacker controls.
  const ip = /^\d{1,3}(\.\d{1,3}){3}$/.test(name) || /^\[[0-9a-f:.]+\]$/.test(name);
  const listed = (env.NOVAFIELD_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return ip || listed.includes(name);
}

const refuse = (error = "Changes are only accepted from NovaField itself.") => NextResponse.json({ error }, { status: 403 });

export const config = { matcher: "/api/:path*" };
