import { describe, expect, it, vi } from "vitest";
import { createGate4RateLimiter, type RateLimitPolicy } from "./rate-limit";
import { postgresAtomicRateStore, type RateLimitRpc } from "./rate-limit-store";

const policy: RateLimitPolicy = {
  windowSeconds: 900, emailStartsPerAddress: 5, emailStartsPerSource: 120,
  audioUploadsPerRespondent: 20, audioUploadsPerSource: 120,
};
const secret = "synthetic-test-only-key-with-at-least-32-bytes";

function setup(data: unknown, error: unknown = null) {
  const rpc = vi.fn(async () => ({ data, error }));
  const client = { rpc } as unknown as RateLimitRpc;
  const limiter = createGate4RateLimiter({ store: postgresAtomicRateStore(client),
    hmacSecret: secret, policy });
  return { rpc, limiter };
}

describe("Gate 4 rate store RPC contract", () => {
  it("sends exactly two hashed rules in one RPC and accepts a valid decision", async () => {
    const { rpc, limiter } = setup({ allowed: true });
    expect(await limiter.emailStart(" Person@Example.Test ", "trusted-ip-a")).toEqual({ kind: "allow" });
    expect(rpc).toHaveBeenCalledOnce();
    const [name, args] = rpc.mock.calls[0] as unknown as [string, { requested_rules: Record<string, unknown>[] }];
    expect(name).toBe("consume_gate4_rate_limit");
    expect(args.requested_rules).toHaveLength(2);
    expect(args.requested_rules.map((rule) => [rule.surface, rule.key_kind, rule.max_attempts,
      rule.window_seconds])).toEqual([
      ["email-start", "email", 5, 900], ["email-start", "source", 120, 900],
    ]);
    for (const rule of args.requested_rules) expect(rule.key_digest).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(args)).not.toMatch(/person@|trusted-ip-a/i);
  });

  it("maps a database denial to a bounded retry decision", async () => {
    const { limiter } = setup({ allowed: false, retry_after_seconds: 31 });
    expect(await limiter.audioUpload("00000000-0000-4000-8000-000000000041", "trusted-ip-a"))
      .toEqual({ kind: "limited", retryAfterSeconds: 31 });
  });

  it.each([
    { data: null, error: null },
    { data: { allowed: false, retry_after_seconds: 0 }, error: null },
    { data: { allowed: "yes" }, error: null },
    { data: { allowed: true }, error: { code: "synthetic_outage" } },
  ])("fails closed on unavailable or malformed RPC result: %j", async ({ data, error }) => {
    const { limiter } = setup(data, error);
    expect(await limiter.emailStart("person@example.test", "trusted-ip-a")).toEqual({ kind: "unavailable" });
  });
});
