import { NextResponse, type NextRequest } from "next/server";

// The app has no accounts: anyone who can reach it can render, upload and install node packs. A web
// page in the same browser can reach it too, so changes are only taken from the app's own pages
// (or from tools like the CLI, which send no Origin). Reads stay open.
const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

export function proxy(request: NextRequest) {
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

const refuse = () => NextResponse.json({ error: "Changes are only accepted from NovaField itself." }, { status: 403 });

export const config = { matcher: "/api/:path*" };
