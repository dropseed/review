/**
 * Hash utilities for hunk content.
 */

import { createHash } from "node:crypto";

/**
 * Hash content using MD5, returning first 8 characters.
 */
export function hashContent(content: string): string {
  return createHash("md5").update(content).digest("hex").slice(0, 8);
}

/**
 * Get the key for identifying a hunk (filepath:hash).
 */
export function getHunkKey(filePath: string, hunkHash: string): string {
  return `${filePath}:${hunkHash}`;
}

/**
 * Parse a hunk key into (file_path, hash).
 */
export function parseHunkKey(hunkKey: string): { filePath: string; hash: string } {
  const lastColon = hunkKey.lastIndexOf(":");
  if (lastColon === -1) {
    throw new Error(`Invalid hunk key: ${hunkKey}`);
  }
  return {
    filePath: hunkKey.slice(0, lastColon),
    hash: hunkKey.slice(lastColon + 1),
  };
}
