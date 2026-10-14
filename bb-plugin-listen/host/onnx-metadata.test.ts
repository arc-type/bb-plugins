import { describe, expect, it } from "vitest";
import { CHARACTER_FRONTEND_METADATA, withMetadata } from "./onnx-metadata";

/** Read the appended entries back the way a protobuf parser would. */
function readEntries(tail: Buffer): Record<string, string> {
  const result: Record<string, string> = {};
  let at = 0;
  while (at < tail.length) {
    expect(tail[at]).toBe(0x72); // metadata_props
    const length = tail[at + 1]!;
    const entry = tail.subarray(at + 2, at + 2 + length);
    const keyLength = entry[1]!;
    const key = entry.subarray(2, 2 + keyLength).toString();
    const valueLength = entry[2 + keyLength + 1]!;
    result[key] = entry.subarray(2 + keyLength + 2, 2 + keyLength + 2 + valueLength).toString();
    at += 2 + length;
  }
  return result;
}

describe("withMetadata", () => {
  const original = Buffer.from("pretend this is an onnx file");

  it("leaves the original bytes untouched and appends the entries", () => {
    const patched = withMetadata(original, CHARACTER_FRONTEND_METADATA);
    expect(patched.subarray(0, original.length).equals(original)).toBe(true);
    expect(readEntries(patched.subarray(original.length))).toEqual(CHARACTER_FRONTEND_METADATA);
  });

  it("adds nothing for no entries", () => {
    expect(withMetadata(original, {}).equals(original)).toBe(true);
  });

  it("writes the marker that the already-patched check looks for", () => {
    const patched = withMetadata(original, CHARACTER_FRONTEND_METADATA);
    expect(patched.includes("\n\bfrontend")).toBe(true);
    expect(original.includes("\n\bfrontend")).toBe(false);
  });
});
