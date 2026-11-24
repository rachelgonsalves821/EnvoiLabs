import { describe, expect, it } from "vitest";
import { rateLimitRejection } from "./rate-limit-http";

describe("Gate 4 standalone route response fixture", () => {
  it("continues an allowed request without changing the response", () => {
    expect(rateLimitRejection({ kind: "allow" })).toBeNull();
  });

  it("returns one private generic 429 with a bounded retry interval", async () => {
    const response = rateLimitRejection({ kind: "limited", retryAfterSeconds: 9000 });
    expect(response?.status).toBe(429);
    expect(response?.headers.get("Retry-After")).toBe("3600");
    expect(response?.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response?.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(await response?.json()).toEqual({ ok: false });
  });

  it("fails closed as a generic 503 when the store is unavailable", async () => {
    const response = rateLimitRejection({ kind: "unavailable" });
    expect(response?.status).toBe(503);
    expect(response?.headers.get("Retry-After")).toBe("5");
    expect(await response?.json()).toEqual({ ok: false });
  });

  it("uses the existing generic invalid-request shape", async () => {
    const response = rateLimitRejection({ kind: "invalid" });
    expect(response?.status).toBe(400);
    expect(response?.headers.has("Retry-After")).toBe(false);
    expect(await response?.json()).toEqual({ ok: false });
  });
});
