/**
 * Switching a Piper voice from espeak phonemes to plain letters.
 *
 * Most Piper voices are trained on IPA phonemes, and sherpa-onnx runs espeak
 * over the text to produce them. A few — `uk_UA-ukrainian_tts` is one — are
 * trained on the text's own letters: their `tokens.txt` is the Cyrillic
 * alphabet. sherpa-onnx still runs espeak for them, because the file says
 * `has_espeak=1`, and then drops nearly every phoneme as "unknown": half a
 * second of noise comes out.
 *
 * sherpa-onnx has a letters frontend, chosen by a `frontend` metadata entry
 * these Piper exports do not carry. An ONNX file is a protobuf, and metadata
 * is a repeated field (`metadata_props`, number 14), so appending entries
 * after the last byte is a valid edit and touches nothing else.
 *
 * Found by transcribing the output: the unpatched voice came back as
 * "Oh yeah.", the patched one as the sentence that was spoken.
 */

import { readFileSync, writeFileSync } from "node:fs";

/** What sherpa-onnx reads to pick the letters frontend and lay out the ids. */
export const CHARACTER_FRONTEND_METADATA: Record<string, string> = {
  frontend: "characters",
  // Piper interleaves the pad symbol ("_", id 0) between letters and wraps
  // the text in ^ and $; these two make the frontend do the same.
  add_blank: "1",
  blank_id: "0",
  use_eos_bos: "1",
};

function varint(value: number): Buffer {
  const bytes: number[] = [];
  let rest = value;
  while (rest > 127) {
    bytes.push((rest & 127) | 128);
    rest >>>= 7;
  }
  bytes.push(rest);
  return Buffer.from(bytes);
}

/** One `metadata_props` entry: a StringStringEntryProto wrapped as field 14. */
function metadataEntry(key: string, value: string): Buffer {
  const k = Buffer.from(key);
  const v = Buffer.from(value);
  const entry = Buffer.concat([
    Buffer.from([0x0a]), varint(k.length), k,
    Buffer.from([0x12]), varint(v.length), v,
  ]);
  return Buffer.concat([Buffer.from([0x72]), varint(entry.length), entry]);
}

/** The file with the entries appended. Pure, so it can be tested on bytes. */
export function withMetadata(file: Buffer, entries: Record<string, string>): Buffer {
  return Buffer.concat([
    file,
    ...Object.entries(entries).map(([key, value]) => metadataEntry(key, value)),
  ]);
}

/**
 * Patch the model file in place, once. Detects its own earlier edit by the
 * `frontend` key, which these files never carry otherwise.
 */
export function ensureCharacterFrontend(onnxPath: string): void {
  const file = readFileSync(onnxPath);
  if (file.includes("\n\bfrontend")) return;
  writeFileSync(onnxPath, withMetadata(file, CHARACTER_FRONTEND_METADATA));
}
