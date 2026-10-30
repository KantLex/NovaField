// Projects in data/projects.json. Deleting one moves its takes back to Unsorted; takes are never lost.

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Project } from "@/lib/projects";
import { DATA_DIR } from "./config";
import { STORE } from "./store";
import { writeJson } from "./jsonFile";
import { say } from "@/lib/say";

const FILE = path.join(DATA_DIR, "projects.json");

// Every change reads, edits and writes the whole file, so changes run one at a time: otherwise a
// "touch" after a render could write back a list from before a project was created.
let queue: Promise<unknown> = Promise.resolve();
function locked<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

async function load(): Promise<Project[]> {
  try {
    return JSON.parse(await readFile(FILE, "utf8")) as Project[];
  } catch {
    return [];
  }
}

async function save(list: Project[]) {
  await writeJson(FILE, list);
  STORE.events.emit("projects", list);
}

export const listProjects = async () => (await load()).sort((a, b) => b.updatedAt - a.updatedAt);

const cleanName = (name: string) => name.replace(/\s+/g, " ").trim().slice(0, 60);

export function createProject(name: string): Promise<Project> {
  return locked(async () => {
    const n = cleanName(name);
    if (!n) throw new Error(say("Give the project a name."));
    const list = await load();
    if (list.some((p) => p.name.toLowerCase() === n.toLowerCase())) throw new Error(say("There's already a project called “{name}”.", { name: n }));
    const now = Date.now();
    const p: Project = { id: randomUUID().slice(0, 8), name: n, createdAt: now, updatedAt: now };
    await save([p, ...list]);
    return p;
  });
}

export function renameProject(id: string, name: string): Promise<Project> {
  return locked(async () => {
    const n = cleanName(name);
    if (!n) throw new Error(say("Give the project a name."));
    const list = await load();
    const p = list.find((x) => x.id === id);
    if (!p) throw new Error(say("No such project."));
    if (list.some((x) => x.id !== id && x.name.toLowerCase() === n.toLowerCase())) throw new Error(say("There's already a project called “{name}”.", { name: n }));
    p.name = n;
    p.updatedAt = Date.now();
    await save(list);
    return p;
  });
}

/** Remove the folder; its takes go back to Unsorted. */
export async function deleteProject(id: string) {
  await locked(async () => {
    const list = await load();
    await save(list.filter((p) => p.id !== id));
  });
  for (const job of await STORE.all()) if (job.project === id) await STORE.patch(job.id, { project: undefined });
}

export function touchProject(id: string | undefined): Promise<void> {
  if (!id) return Promise.resolve();
  return locked(async () => {
    const list = await load();
    const p = list.find((x) => x.id === id);
    if (!p) return;
    p.updatedAt = Date.now();
    await save(list);
  });
}

export const projectExists = async (id: string) => (await load()).some((p) => p.id === id);
