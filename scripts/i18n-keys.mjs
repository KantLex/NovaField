// Every English string the interface shows, for the translation dictionaries and their test.
// Usage: node scripts/i18n-keys.mjs > keys.json

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const UI_DIRS = ["src/ui", "src/app"];
const DATA_FILES = [
  "src/lib/cinema/moves.ts",
  "src/lib/cinema/looks.ts",
  "src/lib/cinema/custom.ts",
  "src/lib/assets.ts",
  "src/lib/engines/specs.ts",
  "src/lib/engines/sizing.ts",
];
// Shown in the template browser; they come from ComfyUI's own template index.
const EXTRA = ["Image", "Image Tools", "Video", "Video Tools", "Audio", "3D Model", "Vector", "LLM", "Node Basics", "Product & Ads", "Character & Fashion", "Brand & Design", "Foundation", "Applied", "Box"];

const walk = (dir) =>
  readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : /\.(tsx?|mjs)$/.test(f) && !f.includes(".test.") ? [p] : [];
  });

const LIT = /"((?:[^"\\]|\\.)*)"/g;
const unq = (s) => s.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
const keys = new Set(EXTRA);
const add = (s) => {
  const k = unq(s);
  // Skip identifiers, paths and Tailwind class lists that happen to sit in the same places.
  const tokens = k.split(/\s+/);
  const classy = tokens.every((t) => /^[a-z0-9:[\]/._%()#*!,-]+$/.test(t) && !t.endsWith(",")) && tokens.some((t) => /[-:[]/.test(t));
  if (/[A-Za-z]{2}/.test(k) && !/^[a-z_]+$/.test(k) && !k.startsWith("/") && !classy) keys.add(k);
};

/** The first argument of each call to fn(…), with balanced brackets. */
function firstArgs(src, fn) {
  const out = [];
  const re = new RegExp(`\\b${fn}\\(`, "g");
  let m;
  while ((m = re.exec(src))) {
    let depth = 0;
    let i = m.index + m[0].length;
    const start = i;
    let inStr = null;
    for (; i < src.length; i++) {
      const c = src[i];
      if (inStr) {
        if (c === "\\") i++;
        else if (c === inStr) inStr = null;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") inStr = c;
      else if ("([{".includes(c)) depth++;
      else if (")]}".includes(c)) {
        if (depth === 0) break;
        depth--;
      } else if (c === "," && depth === 0) break;
    }
    out.push(src.slice(start, i));
  }
  return out;
}

for (const file of UI_DIRS.flatMap((d) => walk(path.join(ROOT, d)))) {
  const src = readFileSync(file, "utf8");
  // Whatever goes through tr() or toast() is interface text, however short ("of", "{s} s").
  // Literals compared inside the argument (kind === "video" ? … : …) are code, not text.
  for (const fn of ["tr", "toast"])
    for (const arg of firstArgs(src, fn))
      for (const m of arg.matchAll(LIT)) {
        const before = arg.slice(0, m.index);
        const after = arg.slice(m.index + m[0].length);
        const compared = /(===|!==|==|!=)\s*$/.test(before) || /^\s*(===|!==|==|!=)/.test(after);
        if (!compared && /\p{L}/u.test(m[1])) keys.add(unq(m[1]));
      }
  // Props the shared controls translate themselves.
  for (const m of src.matchAll(/\b(aside|hint|offNote|label|title|placeholder|feature|reason)=\{([^{}]*)\}/g)) for (const l of m[2].matchAll(LIT)) add(l[1]);
  // Components that translate a plain label="…" themselves.
  for (const m of src.matchAll(/<(?:IconButton|Slider)\b[^>]*?\blabel="((?:[^"\\]|\\.)*)"/g)) add(m[1]);
  // Data lists shown through tr() at render time.
  for (const m of src.matchAll(/\b(label|title|hint|plural|verb|blurb|message)\s*:\s*"((?:[^"\\]|\\.)*)"/g)) add(m[2]);
  for (const m of src.matchAll(/const (STEPS|SIZE_SHORT|OUTPUT_LABEL|PROBLEMS)[^=]*=\s*([\s\S]*?);\n/g)) for (const l of m[2].matchAll(LIT)) add(l[1]);
  // Henshin's "what's missing" lines.
  for (const m of src.matchAll(/return [^;]*\?[^;]*;/g)) if (/missingText|g\.\w+Source|g\.still/.test(m[0])) for (const l of m[0].matchAll(LIT)) add(l[1]);
}
for (const f of DATA_FILES) {
  const src = readFileSync(path.join(ROOT, f), "utf8");
  for (const m of src.matchAll(/\b(label|plural|hint|title|note)\s*:\s*"((?:[^"\\]|\\.)*)"/g)) add(m[2]);
  for (const m of src.matchAll(/=\s*\{\s*([^}]*)\}/g)) if (/KIND_LABEL/.test(src.slice(Math.max(0, m.index - 60), m.index))) for (const l of m[1].matchAll(LIT)) add(l[1]);
}
const runner = readFileSync(path.join(ROOT, "src/server/runner.ts"), "utf8");
for (const m of runner.matchAll(/stage:\s*"([^"]+)"/g)) add(m[1]);
for (const m of runner.matchAll(/\[\/[^\]]*\/,\s*"([^"]+)"\]/g)) add(m[1]);

add(runner.match(/\?\? "([^"]+)";/)?.[1] ?? "Working");
// Compile notes, shown through tr().
for (const f of ["src/lib/engines/h3.ts", "src/lib/workflows/apply.ts"]) {
  const src = readFileSync(path.join(ROOT, f), "utf8");
  for (const m of src.matchAll(/notes\.push\("((?:[^"\\]|\\.)*)"\)/g)) add(m[1]);
  for (const m of src.matchAll(/const RIG_OFF_NOTE = "((?:[^"\\]|\\.)*)"/g)) add(m[1]);
}
// Sentences the server and shared code send people, written with say() (src/lib/say.ts).
for (const file of walk(path.join(ROOT, "src")))
  for (const arg of firstArgs(readFileSync(file, "utf8"), "say")) for (const m of arg.matchAll(LIT)) if (/\p{L}/u.test(m[1])) keys.add(unq(m[1]));

process.stdout.write(JSON.stringify([...keys].sort(), null, 1) + "\n");
