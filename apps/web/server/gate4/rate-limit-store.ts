import type { AtomicRateLimitStore, RateLimitRule } from "./rate-limit";

type StoredRule = {
  surface: RateLimitRule["surface"];
  key_kind: RateLimitRule["keyKind"];
  key_digest: string;
  max_attempts: number;
  window_seconds: number;
};

export type RateLimitRpc = {
  rpc(name: "consume_gate4_rate_limit", args: { requested_rules: [StoredRule, StoredRule] }):
    Promise<{ data: unknown; error: unknown }>;
};

// The caller must pass a service-role RPC adapter. A null/error/malformed reply is an outage,
// which createGate4RateLimiter turns into an unavailable decision before any downstream action.
export function postgresAtomicRateStore(client: RateLimitRpc): AtomicRateLimitStore {
  return {
    async consume(rules) {
      const requested_rules = rules.map((rule) => ({
        surface: rule.surface, key_kind: rule.keyKind, key_digest: rule.keyDigest,
        max_attempts: rule.maxAttempts, window_seconds: rule.windowSeconds,
      })) as [StoredRule, StoredRule];
      const { data, error } = await client.rpc("consume_gate4_rate_limit", { requested_rules });
      if (error || !data || typeof data !== "object" || Array.isArray(data)) {
        throw new Error("Rate-limit store unavailable");
      }
      const reply = data as Record<string, unknown>;
      if (reply.allowed === true) return { allowed: true };
      if (reply.allowed === false && Number.isSafeInteger(reply.retry_after_seconds) &&
          Number(reply.retry_after_seconds) > 0) {
        return { allowed: false, retryAfterSeconds: Number(reply.retry_after_seconds) };
      }
      throw new Error("Rate-limit store returned an invalid decision");
    },
  };
}
