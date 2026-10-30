// The camera vocabulary as text an agent can read: moves, framing, lenses, light, film looks,
// and how to stack moves or write a rig by hand.

import { TIMINGS } from "@/lib/cinema/custom";
import { LIGHTING, LOOKS } from "@/lib/cinema/looks";
import { ANGLES, CATEGORIES, LENSES, MOVES, SHOT_SIZES } from "@/lib/cinema/moves";

export function cameraVocabulary(): string {
  const moves = CATEGORIES.map((c) => {
    const rows = MOVES.filter((m) => m.category === c.id).map((m) => `| \`${m.id}\` | ${m.label} | ${m.hint} |`);
    return `### ${c.label}\n\n| id | name | what it does |\n|---|---|---|\n${rows.join("\n")}`;
  }).join("\n\n");
  return `# NovaField camera vocabulary

Use these ids in \`plan_shot\` / \`generate\` (\`move\`, \`combo\`, \`size\`, \`angle\`, \`lens\`, \`lighting\`, \`look\`).

## Moves

${moves}

## Stacking moves (\`combo\`)

A list of layers; it replaces \`move\`. Each layer is \`{ "id": <move id>, "intensity": 0.3–1.6, "when": "whole" | "start" | "end" }\`.
"whole" layers play together; "start" plays in the first half, "end" in the second. Intensity 0.3 is subtle, 1 normal, 1.6 aggressive.
Example: \`[{"id":"push_in","intensity":1,"when":"whole"},{"id":"pan_left","intensity":0.6,"when":"whole"},{"id":"crane_up","intensity":1,"when":"end"}]\`

## Hand-written rigs (\`rig\`)

Replaces the preset move with marks you write yourself, in the world of the camera-path contract
(novafield://camera/contract): Y up, metres, the subject at the origin about 1.75 m tall.
\`{ "keys": [{ "t": 0, "pos": [x,y,z], "target": [x,y,z], "fov": <vertical degrees>, "roll": 0 }, …], "ease": "linear|inOutSine|inOutCubic|outExpo|inExpo", "actors": [{ "from": [x,z], "to": [x,z], "height": 1.75 }], "follow": null | { "actor": 0, "height": 1.4, "amount": 1 }, "props": [{ "at": [x,z], "size": [w,h,d], "rot": 0, "label": "Table" }] }\`
Keys are sorted by \`t\` in 0–1. Up to 3 actors (stand-ins) and 8 props. A 35 mm lens is about 37.8° vertical FOV.

With \`cameraMode: "rig"\` (default) the move is rendered on the GPU as a ghost-rig guide video that steers MiniMax H3; \`"prompt"\` only describes it in words.
Timing presets: ${TIMINGS.map((t) => `\`${t.id}\` (${t.title})`).join(", ")}.

## Framing

Sizes: ${SHOT_SIZES.map((s) => `\`${s.id}\` (${s.label})`).join(", ")}.
Angles: ${ANGLES.map((a) => `\`${a.id}\` (${a.label})`).join(", ")}.
Lenses (mm): ${LENSES.join(", ")}.

## Light and film

Lighting: ${LIGHTING.map((l) => `\`${l.id}\` (${l.label})`).join(", ")}.
Film looks: ${LOOKS.map((l) => `\`${l.id}\` (${l.label}: ${l.note})`).join(", ")}.
`;
}
