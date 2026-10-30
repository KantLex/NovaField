// Add or update interface strings in every language at once.
//
//   node scripts/i18n-add.mjs strings.json      (or pass the JSON itself as the argument)
//   node scripts/i18n-add.mjs --missing         (what the interface shows that a language lacks)
//
// The JSON maps each English string to its translations:
//   { "Save folder": { "ja": "…", "zh-Hant": "…", "zh-Hans": "…", "ko": "…", "es": "…", "pt": "…", "fr": "…", "ru": "…", "th": "…", "vi": "…" } }
// Every language must be there and keep the English {placeholders}. Files stay sorted by key.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const DIR = path.join(ROOT, "src/i18n/locales");
const LOCALES = readdirSync(DIR)
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.slice(0, -5))
  .sort();
const read = (l) => JSON.parse(readFileSync(path.join(DIR, `${l}.json`), "utf8"));
const write = (l, d) => writeFileSync(path.join(DIR, `${l}.json`), JSON.stringify(Object.fromEntries(Object.keys(d).sort((a, b) => a.localeCompare(b, "en")).map((k) => [k, d[k]])), null, 2) + "\n");
const placeholders = (s) => (s.match(/\{\w+\}/g) ?? []).sort().join();

const arg = process.argv[2];
if (!arg) {
  console.error("Usage: node scripts/i18n-add.mjs <strings.json | JSON> | --missing");
  process.exit(1);
}

if (arg === "--missing") {
  const keys = JSON.parse(execFileSync(process.execPath, [path.join(ROOT, "scripts/i18n-keys.mjs")], { encoding: "utf8" }));
  let total = 0;
  for (const l of LOCALES) {
    const d = read(l);
    const missing = keys.filter((k) => !(k in d));
    total += missing.length;
    if (missing.length) console.log(`${l}: ${missing.length} missing\n${missing.map((k) => `  ${JSON.stringify(k)}`).join("\n")}`);
  }
  if (!total) console.log("Every language covers every string.");
  process.exit(total ? 1 : 0);
}

const input = JSON.parse(existsSync(arg) ? readFileSync(arg, "utf8") : arg);
const problems = [];
for (const [en, tr] of Object.entries(input)) {
  for (const l of LOCALES) {
    if (typeof tr?.[l] !== "string" || !tr[l].trim()) problems.push(`${JSON.stringify(en)}: no ${l} translation`);
    else if (placeholders(tr[l]) !== placeholders(en)) problems.push(`${JSON.stringify(en)}: ${l} changes the {placeholders}`);
  }
}
if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
for (const l of LOCALES) {
  const d = read(l);
  for (const [en, tr] of Object.entries(input)) d[en] = tr[l];
  write(l, d);
}
console.log(`Added ${Object.keys(input).length} string(s) in ${LOCALES.length} languages.`);
