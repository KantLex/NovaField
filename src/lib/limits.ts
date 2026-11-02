// Size limits shared by the server config and the request proxy.

/**
 * The largest request the app takes (in practice an upload: footage, a previs clip, a track).
 * The proxy buffers request bodies up to this (next.config.ts) and turns bigger ones away, so a
 * large file is either taken whole or refused in words, never silently cut short.
 */
export const MAX_UPLOAD_BYTES = 2 * 1024 ** 3;
