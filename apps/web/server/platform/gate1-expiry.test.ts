import { NonRetriableError } from "inngest";
import { describe, expect, it, vi } from "vitest";
import { expirySchedulerConfig, runGate1Expiry } from "./gate1-expiry";

const hosted: NodeJS.ProcessEnv = {
  NODE_ENV: "production", VERCEL_ENV: "preview", ENVOI_GATE1_EXPIRY_ENABLED: "1",
  INNGEST_SIGNING_KEY: "fixture-signing", SUPABASE_URL: "https://preview.example.test", SUPABASE_SERVICE_ROLE_KEY: "fixture-db",
};
const local: NodeJS.ProcessEnv = {
  NODE_ENV: "development", ENVOI_GATE1_EXPIRY_ENABLED: "1", INNGEST_DEV: "1",
  SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_SERVICE_ROLE_KEY: "fixture-db",
};

describe("scheduled Gate 1 expiry configuration", () => {
  it("requires explicit opt-in and a signing key in the intended Vercel environments", () => {
    expect(expirySchedulerConfig(hosted)).toEqual({ isDev: false, signingKey: "fixture-signing" });
    expect(expirySchedulerConfig({ ...hosted, VERCEL_ENV: "production" })?.isDev).toBe(false);
    expect(expirySchedulerConfig({ ...hosted, ENVOI_GATE1_EXPIRY_ENABLED: "0" })).toBeNull();
    expect(expirySchedulerConfig({ ...hosted, INNGEST_SIGNING_KEY: undefined })).toBeNull();
    expect(expirySchedulerConfig({ ...hosted, VERCEL_ENV: "development" })).toBeNull();
    expect(expirySchedulerConfig({ ...hosted, INNGEST_DEV: "1" })).toBeNull();
    expect(expirySchedulerConfig({ ...hosted, SUPABASE_SERVICE_ROLE_KEY: " " })).toBeNull();
  });

  it("permits unsigned Dev Server registration only against a loopback database", () => {
    expect(expirySchedulerConfig(local)).toEqual({ isDev: true });
    expect(expirySchedulerConfig({ ...local, NODE_ENV: "production" })).toBeNull();
    expect(expirySchedulerConfig({ ...local, SUPABASE_URL: "https://hosted.example.test" })).toBeNull();
    expect(expirySchedulerConfig({ ...local, SUPABASE_URL: "http://127.0.0.1:54321/path" })).toBeNull();
  });
});

describe("scheduled Gate 1 expiry handler", () => {
  const scheduled = Date.parse("2026-11-22T13:45:00.123Z");

  it("sends the exact scheduled cutoff on replay and returns only aggregate counts", async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: { expiredInvites: 2, abandonedSessions: 1, unnecessary: "omit" }, error: null })
      .mockResolvedValueOnce({ data: { expiredInvites: 0, abandonedSessions: 0 }, error: null });
    expect(await runGate1Expiry(scheduled, { rpc })).toEqual({ expiredInvites: 2, abandonedSessions: 1 });
    expect(await runGate1Expiry(scheduled, { rpc })).toEqual({ expiredInvites: 0, abandonedSessions: 0 });
    expect(rpc.mock.calls).toEqual(Array(2).fill(["expire_gate1_interviews", { supplied_cutoff: "2026-11-22T13:45:00.123Z" }]));
  });

  it("skips invalid scheduler timestamps without querying the database or retrying", async () => {
    const rpc = vi.fn();
    for (const cutoff of [undefined, Number.NaN, 8_640_000_000_000_001]) {
      await expect(runGate1Expiry(cutoff, { rpc })).rejects.toBeInstanceOf(NonRetriableError);
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns a retryable error without exposing database errors or malformed output", async () => {
    const rpc = vi.fn().mockRejectedValueOnce(new Error("private database error"))
      .mockResolvedValueOnce({ data: null, error: { message: "private provider detail" } })
      .mockResolvedValueOnce({ data: { expiredInvites: -1, abandonedSessions: 0 }, error: null });
    for (let attempt = 0; attempt < 3; attempt++) {
      await expect(runGate1Expiry(scheduled, { rpc })).rejects.toThrow(/^Gate 1 expiry database operation failed\.$/);
    }
  });
});
