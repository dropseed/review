/**
 * Base64 → bytes helper for terminal PTY data. The one-shot replay result
 * arrives as base64 (`dataB64`) and xterm writes raw bytes. Kept
 * dependency-free so it can be unit-tested without the store/DOM.
 *
 * Encoding is not needed: the WebSocket transport carries raw binary frames and
 * the Tauri path only ever decodes replay/output payloads.
 */

export function decodeBase64(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}
