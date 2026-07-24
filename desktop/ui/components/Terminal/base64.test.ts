import { describe, it, expect } from "vitest";
import { decodeBase64 } from "./base64";

describe("decodeBase64", () => {
  it("decodes a known base64 string to its bytes", () => {
    // "hi"
    expect(decodeBase64("aGk=")).toEqual(new Uint8Array([0x68, 0x69]));
  });

  it("decodes an empty string to an empty buffer", () => {
    expect(decodeBase64("")).toEqual(new Uint8Array([]));
  });

  it("preserves all byte values, including 0x00 and 0xff", () => {
    // Base64 of the bytes [0x00, 0x01, 0x7f, 0x80, 0xfe, 0xff, 0x00].
    const bytes = new Uint8Array([0x00, 0x01, 0x7f, 0x80, 0xfe, 0xff, 0x00]);
    const b64 = btoa(String.fromCharCode(...bytes));
    expect(Array.from(decodeBase64(b64))).toEqual(Array.from(bytes));
  });
});
