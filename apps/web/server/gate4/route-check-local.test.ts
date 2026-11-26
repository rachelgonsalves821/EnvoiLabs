import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { createGate4RouteCheck } from "./route-check";

describe.skipIf(process.env.ENVOI_GATE4_RPC_LOCAL !== "1")("Gate 4 disposable RPC route adapter", () => {
  const env = {
    VERCEL: "1", VERCEL_ENV: "preview", GATE4_RATE_LIMIT_PREVIEW_ENABLED: "1",
    GATE4_RATE_LIMIT_HMAC_KEY: process.env.GATE4_RATE_LIMIT_HMAC_KEY,
    GATE4_RATE_LIMIT_WINDOW_SECONDS: process.env.GATE4_RPC_WINDOW_SECONDS,
    GATE4_RATE_LIMIT_EMAIL_PER_ADDRESS: process.env.GATE4_RPC_EMAIL_PER_ADDRESS,
    GATE4_RATE_LIMIT_EMAIL_PER_SOURCE: process.env.GATE4_RPC_EMAIL_PER_SOURCE,
    GATE4_RATE_LIMIT_AUDIO_PER_RESPONDENT: process.env.GATE4_RPC_AUDIO_PER_RESPONDENT,
    GATE4_RATE_LIMIT_AUDIO_PER_SOURCE: process.env.GATE4_RPC_AUDIO_PER_SOURCE,
  };

  it("uses the real service RPC and honors both disposable policy surfaces", async () => {
    const check = createGate4RouteCheck(undefined, env);
    const nonce = randomUUID();
    const hex = nonce.replaceAll("-", "");
    const request = new NextRequest("http://127.0.0.1:3100", {
      headers: { "x-vercel-forwarded-for":
        `2001:db8:${hex.slice(0, 4)}:${hex.slice(4, 8)}:${hex.slice(8, 12)}:${hex.slice(12, 16)}::1` },
    });
    const emailMax = Number(env.GATE4_RATE_LIMIT_EMAIL_PER_ADDRESS);
    const audioMax = Number(env.GATE4_RATE_LIMIT_AUDIO_PER_RESPONDENT);
    expect(Number.isSafeInteger(emailMax) && emailMax > 0).toBe(true);
    expect(Number.isSafeInteger(audioMax) && audioMax > 0).toBe(true);
    for (let index = 0; index < emailMax; index++) {
      expect(await check(request, "email-start", `gate4-${nonce}@example.test`))
        .toEqual({ kind: "allow" });
    }
    expect((await check(request, "email-start", `gate4-${nonce}@example.test`)).kind)
      .toBe("limited");
    for (let index = 0; index < audioMax; index++) {
      expect(await check(request, "audio-upload", nonce)).toEqual({ kind: "allow" });
    }
    expect((await check(request, "audio-upload", nonce)).kind).toBe("limited");
  });
});
