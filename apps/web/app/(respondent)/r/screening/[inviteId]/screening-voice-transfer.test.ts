import { afterEach, describe, expect, it, vi } from "vitest";
import { submitScreeningVoice, type ScreeningVoiceTransfer } from "./screening-voice-transfer";

const inviteId = "11111111-1111-4111-8111-111111111111";
const ruleId = "22222222-2222-4222-8222-222222222222";
const audioObjectId = "33333333-3333-4333-8333-333333333333";
const uploadUrl = "https://private.example.test/upload";
const take = { answerId: "44444444-4444-4444-8444-444444444444",
  blob: new Blob([Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3])],
    { type: "audio/webm" }), localUrl: "blob:fixture", durationMs: 5000,
  mime: "audio/webm" };
const scope = { inviteId, ruleId, ruleVersion: 1, take };
afterEach(() => vi.unstubAllGlobals());

describe("private voice screening transfer", () => {
  it("uses a scoped reservation, anonymous signed PUT, and idempotent confirmation", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ audioObjectId, uploadUrl,
        expiresAt: new Date(Date.now() + 600_000).toISOString() }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "queued" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "queued" }), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    const transfer: ScreeningVoiceTransfer = { takeId: take.answerId };
    const signal = new AbortController().signal;
    expect(await submitScreeningVoice({ ...scope, transfer, signal })).toBe(200);
    expect(fetcher).toHaveBeenNthCalledWith(2, uploadUrl, expect.objectContaining({
      credentials: "omit", referrerPolicy: "no-referrer", redirect: "error",
      body: take.blob,
    }));
    expect(await submitScreeningVoice({ ...scope, transfer, signal })).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(fetcher).toHaveBeenNthCalledWith(4,
      `/api/respondent/screening/${inviteId}/audio`, expect.objectContaining({ method: "PUT" }));
  });
  it("does not confirm a failed upload or reuse a transfer for another take", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ audioObjectId, uploadUrl,
        expiresAt: new Date(Date.now() + 600_000).toISOString() }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }));
    vi.stubGlobal("fetch", fetcher);
    const transfer: ScreeningVoiceTransfer = { takeId: take.answerId };
    expect(await submitScreeningVoice({ ...scope, transfer,
      signal: new AbortController().signal })).toBe(503);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(await submitScreeningVoice({ ...scope, transfer: { ...transfer,
      takeId: "55555555-5555-4555-8555-555555555555" },
    signal: new AbortController().signal })).toBe(503);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
