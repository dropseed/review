import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  getFileExtension,
  IMAGE_EXTENSIONS,
  isImagePath,
} from "./file-extension";

/**
 * IMAGE_EXTENSIONS mirrors the backend's `get_image_mime_type` table, which
 * decides `FileContent.contentType`. The frontend uses its copy to know
 * whether to wait for a data URL before drawing a file's section — so an
 * extension added on one side only fails silently (an image renders as an
 * empty text diff, or vice versa). This test is the seam, same as
 * menuParity.test.ts is for the native menu.
 */
const UTIL_RS = resolve(process.cwd(), "../core/src/service/util.rs");

function backendImageExtensions(): Set<string> {
  const src = readFileSync(UTIL_RS, "utf8");
  const fnMatch = src.match(
    /fn get_image_mime_type[\s\S]*?match[\s\S]*?\{([\s\S]*?)\n\s*\}\n/,
  );
  expect(fnMatch, "get_image_mime_type match block not found").toBeTruthy();
  const exts = new Set<string>();
  // Arms look like: `"jpg" | "jpeg" => Some("image/jpeg"),`
  for (const arm of fnMatch![1].matchAll(/"([a-z0-9]+)"\s*(?:\||=>)/g)) {
    exts.add(arm[1]);
  }
  return exts;
}

describe("image extension parity with the backend", () => {
  it("matches get_image_mime_type's extension list", () => {
    expect([...IMAGE_EXTENSIONS].sort()).toEqual(
      [...backendImageExtensions()].sort(),
    );
  });
});

describe("getFileExtension", () => {
  it("lowercases and strips the dot", () => {
    expect(getFileExtension("a/b/Photo.PNG")).toBe("png");
  });

  it("does not mistake a dotted directory for an extension", () => {
    expect(getFileExtension("src.d/Makefile")).toBe("");
  });
});

describe("isImagePath", () => {
  it("recognizes image files and nothing else", () => {
    expect(isImagePath("assets/logo.svg")).toBe(true);
    expect(isImagePath("assets/logo.ts")).toBe(false);
    expect(isImagePath("Makefile")).toBe(false);
  });
});
