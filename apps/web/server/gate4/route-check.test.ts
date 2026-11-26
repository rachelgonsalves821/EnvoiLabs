import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { createGate4RouteCheck } from "./route-check";
import type { RateLimitRule } from "./rate-limit";

const env = {
  VERCEL: "1", VERCEL_ENV: "preview", GATE4_RATE_LIMIT_PREVIEW_ENABLED: "1",
  GATE4_RATE_LIMIT_HMAC_KEY: "synthetic-only-secret-with-at-least-32-bytes",
  GATE4_RATE_LIMIT_WINDOW_SECONDS: "900", GATE4_RATE_LIMIT_EMAIL_PER_ADDRESS: "5",
  GATE4_RATE_LIMIT_EMAIL_PER_SOURCE: "120", GATE4_RATE_LIMIT_AUDIO_PER_RESPONDENT: "20",
  GATE4_RATE_LIMIT_AUDIO_PER_SOURCE: "120",
};
const request = (headers: Record<string, string>) => new NextRequest("https://example.test", { headers });

describe("Gate 4 route seam", () => {
  it("leaves preview disabled and production unaltered", async () => {
    const store = { consume: vi.fn(async () => ({ allowed: true as const })) };
    expect(await createGate4RouteCheck(store, { ...env, GATE4_RATE_LIMIT_PREVIEW_ENABLED: "0" })(
      request({}), "email-start", "person@example.test")).toEqual({ kind: "allow" });
    expect(await createGate4RouteCheck(store, { ...env, VERCEL_ENV: "production" })(
      request({}), "email-start", "person@example.test")).toEqual({ kind: "allow" });
    expect(store.consume).not.toHaveBeenCalled();
  });

  it("fails closed when enabled without a trusted source, config, or store", async () => {
    const store = { consume: vi.fn(async () => ({ allowed: true as const })) };
    const source = request({ "x-vercel-forwarded-for": "203.0.113.7" });
    expect(await createGate4RouteCheck(store, env)(request({ "x-forwarded-for": "203.0.113.7" }),
      "email-start", "person@example.test")).toEqual({ kind: "unavailable" });
    expect(await createGate4RouteCheck(store, { ...env, GATE4_RATE_LIMIT_HMAC_KEY: "" })(source,
      "email-start", "person@example.test")).toEqual({ kind: "unavailable" });
    expect(await createGate4RouteCheck(undefined, env, () => null)(source,
      "email-start", "person@example.test")).toEqual({ kind: "unavailable" });
    expect(store.consume).not.toHaveBeenCalled();
  });

  it("uses the injected atomic store for both approved surfaces", async () => {
    const store = { consume: vi.fn(async (rules: readonly [RateLimitRule, RateLimitRule]) => {
      expect(rules).toHaveLength(2);
      return { allowed: false as const, retryAfterSeconds: 15 };
    }) };
    const check = createGate4RouteCheck(store, env);
    const source = request({ "x-vercel-forwarded-for": "203.0.113.7" });
    expect(await check(source, "email-start", "person@example.test"))
      .toEqual({ kind: "limited", retryAfterSeconds: 15 });
    expect(await check(source, "audio-upload", "00000000-0000-4000-8000-000000000001"))
      .toEqual({ kind: "limited", retryAfterSeconds: 15 });
    expect(store.consume).toHaveBeenCalledTimes(2);
    expect(store.consume.mock.calls[0]?.[0]?.map((rule: { surface: string }) => rule.surface))
      .toEqual(["email-start", "email-start"]);
  });

  it("resolves a service-backed store only after valid preview config and source", async () => {
    const store = { consume: vi.fn(async () => ({ allowed: true as const })) };
    const resolveStore = vi.fn(() => store);
    const check = createGate4RouteCheck(undefined, env, resolveStore);
    expect(await check(request({ "x-forwarded-for": "203.0.113.7" }),
      "email-start", "person@example.test")).toEqual({ kind: "unavailable" });
    expect(resolveStore).not.toHaveBeenCalled();
    expect(await check(request({ "x-vercel-forwarded-for": "203.0.113.7" }),
      "email-start", "person@example.test")).toEqual({ kind: "allow" });
    expect(resolveStore).toHaveBeenCalledOnce();
    expect(store.consume).toHaveBeenCalledOnce();
  });
});
