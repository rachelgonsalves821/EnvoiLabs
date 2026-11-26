import { describe, expect, it } from "vitest";
import { previewRateLimitConfig, previewTrustedSource } from "./preview-config";

const preview = { VERCEL: "1", VERCEL_ENV: "preview" };
const config = {
  ...preview,
  GATE4_RATE_LIMIT_HMAC_KEY: "synthetic-only-secret-with-at-least-32-bytes",
  GATE4_RATE_LIMIT_WINDOW_SECONDS: "900",
  GATE4_RATE_LIMIT_EMAIL_PER_ADDRESS: "5",
  GATE4_RATE_LIMIT_EMAIL_PER_SOURCE: "120",
  GATE4_RATE_LIMIT_AUDIO_PER_RESPONDENT: "20",
  GATE4_RATE_LIMIT_AUDIO_PER_SOURCE: "120",
};

describe("Gate 4 preview ingress and configuration", () => {
  it("accepts exactly one Vercel-forwarded IP only in preview", () => {
    expect(previewTrustedSource(new Headers({ "x-vercel-forwarded-for": "203.0.113.7" }), preview))
      .toBe("203.0.113.7");
    expect(previewTrustedSource(new Headers({ "x-vercel-forwarded-for": "2001:db8::7" }), preview))
      .toBe("2001:db8::7");
    expect(previewTrustedSource(new Headers({ "x-vercel-forwarded-for":
      "2001:0DB8:0000:0000:0000:0000:0000:0007" }), preview)).toBe("2001:db8::7");
    expect(previewTrustedSource(new Headers({ "x-vercel-forwarded-for": "203.0.113.7" }),
      { VERCEL: "1", VERCEL_ENV: "production" })).toBeNull();
  });

  it.each(["", "203.0.113.7, 198.51.100.2", "203.0.113.7:80", "unknown",
    "fe80::1%eth0"])("fails closed for an unusable source: %s", (value) => {
    expect(previewTrustedSource(new Headers({ "x-vercel-forwarded-for": value }), preview)).toBeNull();
  });

  it("ignores client-controlled forwarding headers and missing trusted source", () => {
    const headers = new Headers({ "x-forwarded-for": "203.0.113.7", "x-real-ip": "203.0.113.8" });
    expect(previewTrustedSource(headers, preview)).toBeNull();
    expect(previewTrustedSource(new Headers({ "x-vercel-forwarded-for": "203.0.113.7" }), {}))
      .toBeNull();
  });

  it("requires a dedicated secret and every positive, configurable threshold", () => {
    expect(previewRateLimitConfig(config)?.policy.emailStartsPerAddress).toBe(5);
    expect(previewRateLimitConfig({ ...config, VERCEL_ENV: "production" })).toBeNull();
    expect(previewRateLimitConfig({ ...config, GATE4_RATE_LIMIT_HMAC_KEY: "too-short" })).toBeNull();
    expect(previewRateLimitConfig({ ...config, GATE4_RATE_LIMIT_AUDIO_PER_SOURCE: "" })).toBeNull();
    expect(previewRateLimitConfig({ ...config, GATE4_RATE_LIMIT_EMAIL_PER_SOURCE: "2.5" })).toBeNull();
  });
});
