import { describe, expect, it, vi } from "vitest";
import { deliverQueuedNudges, type ClaimedNudgeDelivery } from "../src/nudge-delivery";

const path = "/r/s/11111111-1111-4111-8111-111111111111.1795555555555." + "A".repeat(43);
const claim: ClaimedNudgeDelivery = {
  deliveryId: "delivery-1", claimId: "claim-1", inviteId: "offer-1",
  respondentId: "respondent-1", expiresAt: "2026-11-25T23:00:00.000Z",
  kind: "halfway", endpoint: "https://push.example.test/a",
  keys: { p256dh: "public-key", auth: "auth-key" },
};

function fixture(send: () => Promise<"sent" | "failed">,
  makeResumePath: () => string | null = () => path) {
  let state: "queued" | "claimed" | "sent" | "failed" = "queued";
  const observe = vi.fn(async (_deliveryId: string, _claimId: string,
    observed: "sent" | "failed") => {
    if (state !== "claimed") return false;
    state = observed;
    return true;
  });
  const transport = { send: vi.fn(send) };
  const input = {
    ledger: {
      listDispatchable: async () => state === "queued" ? ["outbox-1"] : [],
      prepare: async () => ["delivery-1"],
      claim: async () => {
        if (state !== "queued") return null;
        state = "claimed";
        return claim;
      }, observe,
    },
    transport,
    newClaimId: () => "claim-1",
    makeResumePath,
    now: () => new Date("2026-11-24T18:00:00.000Z"),
  };
  return { input, transport, observe, state: () => state };
}

describe("IT-2.6 nudge sender boundary", () => {
  it("sends a signed same-origin payload once across three job replays", async () => {
    const test = fixture(async () => "sent");
    expect(await deliverQueuedNudges(test.input)).toEqual({ prepared: 1, sent: 1, failed: 0, unresolved: 0 });
    expect(await deliverQueuedNudges(test.input)).toEqual({ prepared: 0, sent: 0, failed: 0, unresolved: 0 });
    expect(await deliverQueuedNudges(test.input)).toEqual({ prepared: 0, sent: 0, failed: 0, unresolved: 0 });
    expect(test.transport.send).toHaveBeenCalledExactlyOnceWith(
      { endpoint: claim.endpoint, keys: claim.keys }, { kind: "halfway", path });
    expect(test.observe).toHaveBeenCalledExactlyOnceWith("delivery-1", "claim-1", "sent");
  });

  it("leaves a timed-out transport claim unresolved and never sends it again", async () => {
    const test = fixture(async () => { throw new Error("uncertain provider timeout"); });
    expect(await deliverQueuedNudges(test.input)).toEqual({ prepared: 1, sent: 0, failed: 0, unresolved: 1 });
    expect(test.state()).toBe("claimed");
    expect(await deliverQueuedNudges(test.input)).toEqual({ prepared: 0, sent: 0, failed: 0, unresolved: 0 });
    expect(test.transport.send).toHaveBeenCalledTimes(1);
    expect(test.observe).not.toHaveBeenCalled();
  });

  it("records a definite transport failure but never retries it", async () => {
    const test = fixture(async () => "failed");
    expect(await deliverQueuedNudges(test.input)).toEqual({ prepared: 1, sent: 0, failed: 1, unresolved: 0 });
    expect(await deliverQueuedNudges(test.input)).toEqual({ prepared: 0, sent: 0, failed: 0, unresolved: 0 });
    expect(test.transport.send).toHaveBeenCalledTimes(1);
    expect(test.observe).toHaveBeenCalledExactlyOnceWith("delivery-1", "claim-1", "failed");
  });

  it("rejects an external or expired resume path before any transport call", async () => {
    const external = fixture(async () => "sent", () => "https://evil.test/collect");
    expect(await deliverQueuedNudges(external.input)).toEqual({ prepared: 1, sent: 0, failed: 1, unresolved: 0 });
    expect(external.transport.send).not.toHaveBeenCalled();
    const expired = fixture(async () => "sent", () => path);
    expired.input.now = () => new Date("2026-11-26T00:00:00.000Z");
    expect(await deliverQueuedNudges(expired.input)).toEqual({ prepared: 1, sent: 0, failed: 1, unresolved: 0 });
    expect(expired.transport.send).not.toHaveBeenCalled();
  });

  it("does not send when a ledger adapter returns another claim identity", async () => {
    const test = fixture(async () => "sent");
    test.input.ledger.claim = async () => ({ ...claim, claimId: "another-claim" });
    expect(await deliverQueuedNudges(test.input)).toEqual({ prepared: 1, sent: 0, failed: 0, unresolved: 1 });
    expect(test.transport.send).not.toHaveBeenCalled();
  });
});
