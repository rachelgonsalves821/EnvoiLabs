import { describe, expect, it, vi } from "vitest";
import { createGate4RateLimiter, type AtomicRateLimitStore, type RateLimitPolicy,
  type RateLimitRule } from "./rate-limit";

const policy: RateLimitPolicy = {
  windowSeconds: 900,
  emailStartsPerAddress: 5,
  emailStartsPerSource: 7,
  audioUploadsPerRespondent: 3,
  audioUploadsPerSource: 7,
};
const secret = "synthetic-test-only-key-with-at-least-32-bytes";
const respondentA = "00000000-0000-4000-8000-000000000041";
const respondentB = "00000000-0000-4000-8000-000000000042";
const respondentC = "00000000-0000-4000-8000-000000000043";

function atomicFixture() {
  let nowMs = 0;
  const counts = new Map<string, number>();
  const store: AtomicRateLimitStore = {
    async consume(rules) {
      // No await between the shared check and increments: this fixture models one DB transaction.
      const keys = rules.map((rule) =>
        `${rule.surface}:${rule.keyKind}:${rule.keyDigest}:${Math.floor(nowMs / (rule.windowSeconds * 1000))}`);
      const rejected = rules.find((rule, index) => (counts.get(keys[index]!) ?? 0) >= rule.maxAttempts);
      if (rejected) {
        return { allowed: false, retryAfterSeconds: rejected.windowSeconds -
          Math.floor((nowMs / 1000) % rejected.windowSeconds) };
      }
      keys.forEach((key) => counts.set(key, (counts.get(key) ?? 0) + 1));
      return { allowed: true };
    },
  };
  return { store, counts, advance(ms: number) { nowMs += ms; } };
}

function limiter(store: AtomicRateLimitStore, selectedPolicy = policy) {
  return createGate4RateLimiter({ store, hmacSecret: secret, policy: selectedPolicy });
}

describe("Gate 4 isolated distributed rate decisions", () => {
  it("allows only the shared email quota across two app instances under concurrent starts", async () => {
    const fixture = atomicFixture();
    const first = limiter(fixture.store);
    const second = limiter(fixture.store);
    const dispatchOtp = vi.fn(async () => {});
    const results = await Promise.all(Array.from({ length: 40 }, async (_, index) => {
      const decision = await (index % 2 ? first : second)
        .emailStart(index % 2 ? " Person@Example.Test " : "person@example.test", "trusted-ip-a");
      if (decision.kind === "allow") await dispatchOtp();
      return decision;
    }));
    expect(results.filter((result) => result.kind === "allow")).toHaveLength(5);
    expect(results.filter((result) => result.kind === "limited")).toHaveLength(35);
    expect(dispatchOtp).toHaveBeenCalledTimes(5);
    expect([...fixture.counts.values()]).toEqual([5, 5]);
    fixture.advance(900_000);
    expect(await first.emailStart("person@example.test", "trusted-ip-a")).toEqual({ kind: "allow" });
  });

  it("bounds different email addresses by source and never passes raw identity to the store", async () => {
    const fixture = atomicFixture();
    const seen: RateLimitRule[][] = [];
    const store: AtomicRateLimitStore = { consume: async (rules) => {
      seen.push([...rules]);
      return fixture.store.consume(rules);
    } };
    const decisions = await Promise.all(Array.from({ length: 12 }, (_, index) =>
      limiter(store).emailStart(`person-${index}@example.test`, "trusted-ip-a")));
    expect(decisions.filter((decision) => decision.kind === "allow")).toHaveLength(7);
    expect(seen.every((rules) => rules.length === 2 && rules.every((rule) =>
      /^[a-f0-9]{64}$/.test(rule.keyDigest) && !rule.keyDigest.includes("person")))).toBe(true);
    expect(new Set(seen.map((rules) => rules[0]!.keyDigest)).size).toBe(12);
    expect(new Set(seen.map((rules) => rules[1]!.keyDigest)).size).toBe(1);
  });

  it("keeps the email quota when the source changes", async () => {
    const fixture = atomicFixture();
    const first = limiter(fixture.store);
    const second = limiter(fixture.store);
    const decisions = await Promise.all(Array.from({ length: 12 }, (_, index) =>
      (index % 2 ? first : second).emailStart("person@example.test", `trusted-ip-${index}`)));
    expect(decisions.filter((decision) => decision.kind === "allow")).toHaveLength(5);
  });

  it("caps audio reservations by respondent and source without creating a signed URL on denial", async () => {
    const fixture = atomicFixture();
    const first = limiter(fixture.store);
    const second = limiter(fixture.store);
    const reserveAndSign = vi.fn(async () => {});
    const decisions = await Promise.all(Array.from({ length: 20 }, async (_, index) => {
      const decision = await (index % 2 ? first : second).audioUpload(
        index < 10 ? respondentA : respondentB, "trusted-ip-a");
      if (decision.kind === "allow") await reserveAndSign();
      return decision;
    }));
    expect(decisions.filter((decision) => decision.kind === "allow")).toHaveLength(6);
    expect(reserveAndSign).toHaveBeenCalledTimes(6);
    expect(await first.audioUpload(respondentA, "trusted-ip-b")).toMatchObject({ kind: "limited" });
    expect(await second.audioUpload(respondentB, "trusted-ip-b")).toMatchObject({ kind: "limited" });
  });

  it("caps upload reservations across respondents sharing one source", async () => {
    const fixture = atomicFixture();
    const guard = limiter(fixture.store);
    const reserveAndSign = vi.fn(async () => {});
    const respondents = [respondentA, respondentB, respondentC];
    const decisions = await Promise.all(Array.from({ length: 12 }, async (_, index) => {
      const decision = await guard.audioUpload(respondents[index % respondents.length]!, "trusted-ip-a");
      if (decision.kind === "allow") await reserveAndSign();
      return decision;
    }));
    expect(decisions.filter((decision) => decision.kind === "allow")).toHaveLength(7);
    expect(reserveAndSign).toHaveBeenCalledTimes(7);
  });

  it("fails closed on store outage, malformed result, or missing trusted source", async () => {
    const outage = limiter({ consume: vi.fn(async () => { throw new Error("synthetic store outage"); }) });
    const dispatchOtp = vi.fn(async () => {});
    const decision = await outage.emailStart("person@example.test", "trusted-ip-a");
    if (decision.kind === "allow") await dispatchOtp();
    expect(decision).toEqual({ kind: "unavailable" });
    expect(dispatchOtp).not.toHaveBeenCalled();
    const malformed = limiter({ consume: vi.fn(async () => ({ allowed: false, retryAfterSeconds: 0 })) });
    expect(await malformed.audioUpload(respondentA, "trusted-ip-a")).toEqual({ kind: "unavailable" });
    const consume = vi.fn(async () => ({ allowed: true as const }));
    const guarded = limiter({ consume });
    expect(await guarded.emailStart("person@example.test", "")).toEqual({ kind: "unavailable" });
    expect(await guarded.emailStart("person@example.test", " trusted-ip-a ")).toEqual({ kind: "unavailable" });
    expect(await guarded.emailStart("invalid", "trusted-ip-a")).toEqual({ kind: "invalid" });
    expect(await guarded.audioUpload("invalid", "trusted-ip-a")).toEqual({ kind: "invalid" });
    expect(consume).not.toHaveBeenCalled();
    expect(await limiter({ consume }, { ...policy, emailStartsPerAddress: 0 })
      .emailStart("person@example.test", "trusted-ip-a")).toEqual({ kind: "unavailable" });
    const incomplete = { ...policy, audioUploadsPerSource: undefined as unknown as number };
    expect(await limiter({ consume }, incomplete)
      .emailStart("person@example.test", "trusted-ip-a")).toEqual({ kind: "unavailable" });
    expect(consume).not.toHaveBeenCalled();
  });
});
