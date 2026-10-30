// The skills in skills/ teach agents to use the MCP tools; they must only name tools, parameters
// and camera words that exist, or agents will call things that fail.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LIGHTING, LOOKS } from "@/lib/cinema/looks";
import { ANGLES, MOVES, SHOT_SIZES } from "@/lib/cinema/moves";
import { NO_CAPABILITIES } from "@/lib/engines/capabilities";
import { FRAME_MOVES } from "@/lib/engines/tracks";
import { QUALITIES } from "./shot";

const ROOT = path.join(__dirname, "../..");
const mcp = readFileSync(path.join(ROOT, "src/agent/mcp.ts"), "utf8");
const tools = new Set([...mcp.matchAll(/registerTool\(\s*"(\w+)"/g)].map((m) => m[1]));
// Every key the server reads or returns: inputs (however they're declared) and result fields.
const params = new Set([...mcp.matchAll(/(?:^\s+|[{,]\s*)(\w+): /gm)].map((m) => m[1]));
const enums = new Set([...mcp.matchAll(/z\.enum\(\[([^\]]*)\]/g)].flatMap((m) => [...m[1].matchAll(/"([\w.:]+)"/g)].map((x) => x[1])));
const vocabulary = new Set([...MOVES, ...LOOKS, ...LIGHTING, ...SHOT_SIZES, ...ANGLES, ...FRAME_MOVES].map((x) => x.id));
// Plus what status reports the server can do, the server's own name, JSON literals and the
// commands a skill may suggest running.
const caps = [...Object.keys(NO_CAPABILITIES), ...Object.keys(NO_CAPABILITIES.pack)];
const known = new Set([...tools, ...params, ...enums, ...vocabulary, ...QUALITIES, ...caps, "novafield", "true", "false", "ffmpeg", "ffprobe"]);

const dir = path.join(ROOT, "skills");
const skills = readdirSync(dir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => ({ name: d.name, text: readFileSync(path.join(dir, d.name, "SKILL.md"), "utf8") }));

describe("agent skills", () => {
  it("are all there", () => {
    expect(skills.map((s) => s.name).sort()).toEqual([
      "ad-campaign",
      "character-sheet",
      "comfy-workflows",
      "henshin",
      "lookbook",
      "music-video",
      "novafield-director",
      "one-take",
      "photo-to-video",
      "product-spot",
      "score-and-voice",
      "script-to-film",
      "short-drama",
      "social-series",
      "storyboard-animatic",
      "trailer",
    ]);
  });

  for (const s of skills) known.add(s.name);
  for (const s of skills) {
    it(`${s.name} has frontmatter an agent can pick it by`, () => {
      const front = /^---\nname: ([\w-]+)\ndescription: (.+)\n---\n/.exec(s.text);
      expect(front?.[1]).toBe(s.name);
      expect(front?.[2].length).toBeGreaterThan(80);
      expect(front?.[2]).toMatch(/Use (when|whenever)/);
    });

    it(`${s.name} only names tools, parameters and camera words that exist`, () => {
      // Code words in backticks that look like identifiers (snake_case or a single lowercase word).
      const words = [...s.text.matchAll(/`([a-z][a-z0-9_]*)`/g)].map((m) => m[1]);
      const unknown = [...new Set(words.filter((w) => !known.has(w)))];
      expect(unknown, "Not a tool, parameter or vocabulary id in NovaField").toEqual([]);
    });
  }

  it("the director lists every tool", () => {
    const director = skills.find((s) => s.name === "novafield-director")!.text;
    for (const t of tools) expect(director, t).toContain(`\`${t}\``);
  });
});
