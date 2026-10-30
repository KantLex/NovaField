// Browser tests: NovaField as a person uses it, against a stand-in ComfyUI. Both servers start here,
// with their own data and build folders, so a run never touches data/ or the dev server on 4317.

import os from "node:os";
import path from "node:path";
import { defineConfig } from "@playwright/test";

const PORT = 4318;
const COMFY_PORT = 8199;
const DATA = path.join(os.tmpdir(), "novafield-e2e");

export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  webServer: [
    {
      command: "pnpm tsx e2e/fake-comfy.ts",
      url: `http://127.0.0.1:${COMFY_PORT}/system_stats`,
      env: { PORT: String(COMFY_PORT) },
      reuseExistingServer: false,
    },
    {
      // A fresh, empty data folder for every run.
      command: `node -e "require('fs').rmSync(process.argv[1], { recursive: true, force: true })" "${DATA}" && pnpm next dev -p ${PORT}`,
      url: `http://localhost:${PORT}/api/status`,
      timeout: 240_000,
      env: { NOVAFIELD_DATA: DATA, NOVAFIELD_DIST_DIR: ".next-e2e", COMFY_URL: `http://127.0.0.1:${COMFY_PORT}` },
      reuseExistingServer: false,
    },
  ],
});
