import { describe, expect, it } from "vitest";
import { MAX_UPLOAD_BYTES } from "@/lib/limits";
import { NextRequest } from "next/server";
import { allowedHost, proxy } from "./proxy";

describe("who NovaField answers", () => {
  it("answers at this computer's own names and addresses", () => {
    for (const h of ["localhost:4317", "localhost", "127.0.0.1:4317", "[::1]:4317", "app.localhost:4317"]) expect(allowedHost(h, {})).toBe(true);
  });

  it("refuses a page that pointed its own domain at this computer (DNS rebinding)", () => {
    for (const h of ["evil.example:4317", "localhost.evil.example", "127.0.0.1.nip.io:4317", null, ""]) expect(allowedHost(h, {})).toBe(false);
  });

  it("answers at network addresses only when opted in", () => {
    expect(allowedHost("192.168.1.20:4317", {})).toBe(false);
    expect(allowedHost("192.168.1.20:4317", { NOVAFIELD_LAN: "1" })).toBe(true);
    expect(allowedHost("[fe80::1]:4317", { NOVAFIELD_LAN: "1" })).toBe(true);
    // A name still has to be listed, even on the network.
    expect(allowedHost("studio-mac.local:4317", { NOVAFIELD_LAN: "1" })).toBe(false);
    expect(allowedHost("studio-mac.local:4317", { NOVAFIELD_LAN: "1", NOVAFIELD_ALLOWED_HOSTS: "Studio-Mac.local, other" })).toBe(true);
  });
});

describe("the request guard", () => {
  const req = (method: string, headers: Record<string, string>) => new NextRequest("http://127.0.0.1:4317/api/jobs", { method, headers });

  it("refuses reads and changes addressed to someone else's domain", () => {
    expect(proxy(req("GET", { host: "evil.example:4317" }))?.status).toBe(403);
    expect(proxy(req("PUT", { host: "evil.example:4317", origin: "http://evil.example:4317" }))?.status).toBe(403);
  });

  it("lets the app's own pages and the CLI through", () => {
    expect(proxy(req("GET", { host: "localhost:4317" }))).toBeUndefined();
    expect(proxy(req("PUT", { host: "localhost:4317", origin: "http://localhost:4317" }))).toBeUndefined();
    expect(proxy(req("PUT", { host: "127.0.0.1:4317" }))).toBeUndefined();
    expect(proxy(req("PUT", { host: "localhost:4317", origin: "http://other.example" }))?.status).toBe(403);
  });

  it("takes a big upload whole, and refuses one past the limit in words", async () => {
    const own = { host: "localhost:4317", origin: "http://localhost:4317" };
    expect(proxy(req("POST", { ...own, "content-length": String(500 * 1024 ** 2) }))).toBeUndefined();
    const res = proxy(req("POST", { ...own, "content-length": String(MAX_UPLOAD_BYTES + 1) }));
    expect(res?.status).toBe(413);
    expect((await res!.json()).error).toMatch(/too big: NovaField takes files up to 2 GB/);
  });
});
