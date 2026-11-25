import { Inngest, NonRetriableError } from "inngest";
import { describe, expect, it, vi } from "vitest";
import { gate1ExpiryFunction } from "../../inngest/platform/gate1-expiry";
import { runGate1Expiry } from "./gate1-expiry";
import { gate1InngestConfig } from "./gate1-inngest-config";

const database = vi.hoisted(() => ({ rpc: vi.fn(), storage: { from: vi.fn() } }));
vi.mock("../auth/supabase", async (importOriginal) => ({
  ...await importOriginal<typeof import("../auth/supabase")>(), trustedClient: () => database,
}));

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
    expect(gate1InngestConfig(hosted)).toEqual({
      client: { isDev: false, signingKey: "fixture-signing" }, expiryEnabled: true,
      orphanAudioEnabled: false, privateAnswersEnabled: false,
    });
    expect(gate1InngestConfig({ ...hosted, VERCEL_ENV: "production" })?.client.isDev).toBe(false);
    expect(gate1InngestConfig({ ...hosted, ENVOI_GATE1_EXPIRY_ENABLED: "0" })).toBeNull();
    expect(gate1InngestConfig({ ...hosted, INNGEST_SIGNING_KEY: undefined })).toBeNull();
    expect(gate1InngestConfig({ ...hosted, VERCEL_ENV: "development" })).toBeNull();
    expect(gate1InngestConfig({ ...hosted, INNGEST_DEV: "1" })).toBeNull();
    expect(gate1InngestConfig({ ...hosted, SUPABASE_SERVICE_ROLE_KEY: " " })).toBeNull();
  });

  it("permits unsigned Dev Server registration only against a loopback database", () => {
    expect(gate1InngestConfig(local)).toEqual({
      client: { isDev: true }, expiryEnabled: true, orphanAudioEnabled: false, privateAnswersEnabled: false,
    });
    expect(gate1InngestConfig({ ...local, NODE_ENV: "production" })).toBeNull();
    expect(gate1InngestConfig({ ...local, SUPABASE_URL: "https://hosted.example.test" })).toBeNull();
    expect(gate1InngestConfig({ ...local, SUPABASE_URL: "http://127.0.0.1:54321/path" })).toBeNull();
  });

  it("allows cleanup only with expiry enabled and an explicit local or preview opt-in", () => {
    const cleanup = { ENVOI_GATE1_ORPHAN_AUDIO_ENABLED: "1" };
    expect(gate1InngestConfig({ ...local, ...cleanup })?.orphanAudioEnabled).toBe(true);
    expect(gate1InngestConfig({ ...hosted, ...cleanup })?.orphanAudioEnabled).toBe(true);
    expect(gate1InngestConfig({ ...hosted, ...cleanup, VERCEL_ENV: "production" })?.orphanAudioEnabled).toBe(false);
    expect(gate1InngestConfig({ ...local, ...cleanup, ENVOI_GATE1_EXPIRY_ENABLED: "0" })).toBeNull();
    expect(gate1InngestConfig({ ...hosted, ENVOI_GATE1_ORPHAN_AUDIO_ENABLED: "true" })?.orphanAudioEnabled).toBe(false);
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

describe("Gate 1 expiry and cleanup scheduling", () => {
  function invoke(orphanAudioEnabled: boolean) {
    const client = new Inngest({ id: "envoi-expiry-test", isDev: true });
    const createFunction = vi.spyOn(client, "createFunction");
    gate1ExpiryFunction(client, orphanAudioEnabled);
    const handler: unknown = createFunction.mock.calls[0]?.[1];
    if (typeof handler !== "function") throw new Error("Missing scheduled handler");
    const run = vi.fn((_name: string, operation: () => unknown) => operation());
    const output = handler({ event: { name: "inngest/scheduled.timer", ts: 1 }, step: { run } });
    return { output, run };
  }

  it("runs removal as a separate step after expiry and returns only counts", async () => {
    const path = "11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222";
    const remove = vi.fn().mockResolvedValue({ error: null });
    database.rpc.mockReset()
      .mockResolvedValueOnce({ data: { expiredInvites: 0, abandonedSessions: 1 }, error: null })
      .mockResolvedValueOnce({ data: [{ storage_path: path }], error: null });
    database.storage.from.mockReset().mockReturnValue({ remove });

    const { output, run } = invoke(true);
    await expect(output).resolves.toEqual({ expiredInvites: 0, abandonedSessions: 1, orphanAudioRequested: 1 });
    expect(run.mock.calls.map(([name]) => name)).toEqual(["expire-due-interviews", "remove-expired-unconfirmed-audio"]);
    expect(database.rpc.mock.calls[1]).toEqual(["list_gate1_expired_audio", { supplied_limit: 50 }]);
    expect(database.storage.from).toHaveBeenCalledExactlyOnceWith("gate1-interview-audio");
    expect(remove).toHaveBeenCalledExactlyOnceWith([path]);
  });

  it("skips the cleanup step when disabled or when expiry fails", async () => {
    database.rpc.mockReset()
      .mockResolvedValueOnce({ data: { expiredInvites: 0, abandonedSessions: 0 }, error: null })
      .mockResolvedValueOnce({ data: null, error: new Error("private expiry failure") });
    database.storage.from.mockClear();

    const disabled = invoke(false);
    await expect(disabled.output).resolves.toEqual({ expiredInvites: 0, abandonedSessions: 0 });
    expect(disabled.run).toHaveBeenCalledTimes(1);
    const failed = invoke(true);
    await expect(failed.output).rejects.toThrow("Gate 1 expiry database operation failed.");
    expect(failed.run).toHaveBeenCalledTimes(1);
    expect(database.storage.from).not.toHaveBeenCalled();
  });
});
