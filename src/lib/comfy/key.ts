/**
 * Comfy account keys from platform.comfy.org start with "comfyui-" and a long token. Loose on
 * purpose: this only decides whether to offer a copied text as the key, and the server test is
 * what actually checks it.
 */
export const looksLikeComfyKey = (text: string) => /^comfyui-[A-Za-z0-9_-]{16,}$/.test(text.trim());
