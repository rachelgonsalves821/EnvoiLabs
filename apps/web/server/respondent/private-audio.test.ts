import { describe, expect, it } from "vitest";
import { baseAudioMime, matchesAudioContainer } from "./private-audio";

describe("private audio input", () => {
  it("normalizes browser codec suffixes without allowing video or arbitrary files", () => {
    expect(baseAudioMime("audio/webm;codecs=opus")).toBe("audio/webm");
    expect(baseAudioMime("audio/mp4")).toBe("audio/mp4");
    expect(baseAudioMime("video/webm")).toBeUndefined();
    expect(baseAudioMime("application/octet-stream")).toBeUndefined();
    expect(baseAudioMime(null)).toBeUndefined();
  });

  it("requires the uploaded bytes to agree with the expected container", () => {
    expect(matchesAudioContainer(Buffer.from("1a45dfa3", "hex"), "audio/webm")).toBe(true);
    expect(matchesAudioContainer(Buffer.from("0000ftyp"), "audio/mp4")).toBe(true);
    expect(matchesAudioContainer(Buffer.from("RIFF0000WAVE"), "audio/wav")).toBe(true);
    expect(matchesAudioContainer(Buffer.from("OggS"), "audio/ogg")).toBe(true);
    expect(matchesAudioContainer(Buffer.from("OggS"), "audio/webm")).toBe(false);
    expect(matchesAudioContainer(Buffer.alloc(0), "audio/wav")).toBe(false);
  });
});
