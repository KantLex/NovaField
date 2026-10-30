import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // The browser tests' own server build, and their reports.
    ".next-e2e/**",
    "test-results/**",
    "playwright-report/**",
    // The promo video's Remotion project, kept out of git.
    "promo/**",
  ]),
]);

export default eslintConfig;
