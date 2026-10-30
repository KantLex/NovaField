// Which missing nodes actually stop a workflow from running.

/** Nodes that only show values in the ComfyUI canvas; a headless run can do without them. */
export const isDisplayOnly = (node: string) => /(^|\s|_)(show|display|preview|note|print|debug)/i.test(node) && !/save/i.test(node);

/**
 * Missing nodes that block a run. Display-only nodes don't: the converter already leaves them
 * out, and if something did depend on one, preflight still catches the broken wire.
 */
export const blockingMissing = (missing: string[]) => missing.filter((n) => !isDisplayOnly(n));
