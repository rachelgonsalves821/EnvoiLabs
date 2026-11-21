import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type Mime = "audio/webm" | "audio/mp4" | "audio/wav";
type Fixture = { file: string; mime: Mime; sha256: string; seconds: number; text: string };

const base = new URL("../fixtures/audio/", import.meta.url);
const { cases } = JSON.parse(readFileSync(new URL("manifest.json", base), "utf8")) as { cases: Fixture[] };
const signatures: Record<Mime, (bytes: Buffer) => boolean> = {
  "audio/webm": (bytes) => bytes.subarray(0, 4).toString("hex") === "1a45dfa3",
  "audio/mp4": (bytes) => bytes.toString("ascii", 4, 8) === "ftyp",
  "audio/wav": (bytes) => bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WAVE",
};

describe("Gate 1 synthetic audio", () => {
  it("includes five distinct fixtures covering the supported containers", () => {
    expect(cases).toHaveLength(5);
    expect(new Set(cases.map(({ file }) => file)).size).toBe(5);
    expect(new Set(cases.map(({ mime }) => mime))).toEqual(new Set(Object.keys(signatures)));
  });

  it.each(cases)("matches the manifest for $file", ({ file, mime, sha256, seconds, text }) => {
    const bytes = readFileSync(new URL(file, base));
    expect(signatures[mime](bytes)).toBe(true);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(sha256);
    expect(seconds).toBeGreaterThan(0);
    expect(text.trim()).not.toBe("");
  });
});
