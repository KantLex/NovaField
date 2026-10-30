import path from "node:path";
import { fileURLToPath } from "node:url";

/** A file in the repository, wherever the agent tools are started from. */
export const repoFile = (rel: string) => path.join(fileURLToPath(new URL("../..", import.meta.url)), rel);
