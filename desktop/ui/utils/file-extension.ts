/** Extract lowercase file extension (without dot) from a file path, or empty string. */
export function getFileExtension(filePath: string): string {
  const lastDot = filePath.lastIndexOf(".");
  const lastSlash = filePath.lastIndexOf("/");
  if (lastDot > lastSlash) {
    return filePath.slice(lastDot + 1).toLowerCase();
  }
  return "";
}

// Mirrors the backend's image extension list (`get_image_mime_type` in
// core/src/service/util.rs). The two must agree: a path this misses renders
// as an empty text diff instead of waiting for its data URL. Kept honest by
// file-extension.test.ts, which parses the Rust match arms.
export const IMAGE_EXTENSIONS = new Set([
  "svg",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "avif",
  "ico",
  "icns",
  "bmp",
]);

/** Whether a path names an image file, by extension (the backend's list). */
export function isImagePath(filePath: string): boolean {
  return IMAGE_EXTENSIONS.has(getFileExtension(filePath));
}
