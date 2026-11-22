import { copyFile, mkdtemp, rmdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { transcriptionSmoke } from "../evals/transcription-smoke.mjs";

describe("Gate 1 transcription smoke", () => {
  it("verifies checked-in synthetic formats offline and reports presence only", async () => {
    const fetch = vi.fn();
    const report = await transcriptionSmoke({ mode: "preflight", env: { OPENAI_API_KEY: "test-secret" }, fetch });

    expect(report.fixtureCount).toBe(5);
    expect(new Set(report.files.map((file) => file.mime))).toEqual(new Set(["audio/webm", "audio/mp4", "audio/wav"]));
    expect(report.providers.find((provider) => provider.provider === "openai")).toMatchObject({ credentialConfigured: true });
    expect(report.providers.find((provider) => provider.provider === "groq")).toMatchObject({ credentialConfigured: false });
    expect(JSON.stringify(report)).not.toContain("test-secret");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses live mode without the requested provider credential", async () => {
    const fetch = vi.fn();
    await expect(transcriptionSmoke({ mode: "groq", env: { OPENAI_API_KEY: "other-provider" }, fetch }))
      .rejects.toThrow("GROQ_API_KEY is required");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("blocks changed fixture bytes before making any network request", async () => {
    const path = await mkdtemp(join(tmpdir(), "envoi-stt-"));
    const source = fileURLToPath(new URL("../../testing/fixtures/audio/manifest.json", import.meta.url));
    const manifest = join(path, "manifest.json");
    const modified = join(path, "01-delivery.webm");
    const fetch = vi.fn();
    try {
      await copyFile(source, manifest);
      await writeFile(modified, "unapproved fixture");
      await expect(transcriptionSmoke({ mode: "openai", env: { OPENAI_API_KEY: "test-secret" }, fetch, root: pathToFileURL(path + sep) }))
        .rejects.toThrow("Synthetic fixture integrity check failed");
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      await Promise.all([rm(manifest, { force: true }), rm(modified, { force: true })]);
      await rmdir(path);
    }
  });

  it.each([
    ["openai", "OPENAI_API_KEY", "gpt-transcribe", "https://api.openai.com/v1/audio/transcriptions", 150],
    ["groq", "GROQ_API_KEY", "whisper-large-v3-turbo", "https://api.groq.com/openai/v1/audio/transcriptions", 112],
  ])("uses the %s adapter and leaves transcripts out of the evidence", async (mode, key, model, endpoint, cost) => {
    const fetch = vi.fn(async (_url, request) => {
      expect(request.body.get("model")).toBe(model);
      expect(request.body.get("file")).toBeInstanceOf(Blob);
      return Response.json({ text: "synthetic transcript content", usage: { type: "duration", seconds: 2 } });
    });

    const report = await transcriptionSmoke({ mode, env: { [key]: "test-secret" }, fetch });

    expect(fetch).toHaveBeenCalledTimes(5);
    expect(fetch.mock.calls.every(([url]) => url === endpoint)).toBe(true);
    expect(report.files.every((entry) => entry.model === model && entry.estimatedCostMicros === cost)).toBe(true);
    expect(JSON.stringify(report)).not.toMatch(/synthetic transcript content|test-secret/);
  });
});
