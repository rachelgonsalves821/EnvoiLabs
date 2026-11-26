import { describe, expect, it, vi } from "vitest";
import { dispatchMatchedOfferPush } from "../src/offer-push";

const claim = { deliveryId: "delivery", claimId: "claim", inviteId: "offer",
  respondentId: "respondent", expiresAt: "2026-11-27T00:00:00Z",
  endpoint: "https://push.example.test/send",
  keys: { p256dh: "synthetic-public", auth: "synthetic-auth" } };
const setup = () => ({
  readCandidates: vi.fn().mockResolvedValue(["offer"]),
  enqueue: vi.fn().mockResolvedValue(true),
  listDispatchable: vi.fn().mockResolvedValue(["outbox"]),
  prepare: vi.fn().mockResolvedValue(["delivery"]),
  claim: vi.fn().mockResolvedValue(claim),
  observe: vi.fn().mockResolvedValue(true),
});
const now = () => new Date("2026-11-26T00:00:00Z");

describe("matched-offer push dispatch", () => {
  it("sends a generic home payload after one private claim", async () => {
    const ledger = setup();
    const transport = { send: vi.fn().mockResolvedValue("sent" as const) };
    expect(await dispatchMatchedOfferPush({ ledger, transport,
      newClaimId: () => "claim", now })).toEqual({ queued: 1,
      sent: 1, failed: 0, unresolved: 0 });
    expect(transport.send).toHaveBeenCalledWith({ endpoint: claim.endpoint,
      keys: claim.keys }, { kind: "matched_offer", path: "/r" });
    expect(ledger.observe).toHaveBeenCalledWith("delivery", "claim", "sent");
  });

  it("does not retry an uncertain transport outcome after the first claim", async () => {
    const ledger = setup();
    ledger.claim.mockResolvedValueOnce(claim).mockResolvedValueOnce(null);
    const transport = { send: vi.fn().mockRejectedValue(new Error("uncertain")) };
    expect((await dispatchMatchedOfferPush({ ledger, transport,
      newClaimId: () => "claim", now })).unresolved).toBe(1);
    expect((await dispatchMatchedOfferPush({ ledger, transport,
      newClaimId: () => "claim", now })).sent).toBe(0);
    expect(transport.send).toHaveBeenCalledOnce();
    expect(ledger.observe).not.toHaveBeenCalled();
  });

  it("settles an expired claim as failed without push access", async () => {
    const ledger = setup();
    ledger.claim.mockResolvedValue({ ...claim,
      expiresAt: "2026-11-25T00:00:00Z" });
    const transport = { send: vi.fn() };
    expect(await dispatchMatchedOfferPush({ ledger, transport,
      newClaimId: () => "claim", now })).toMatchObject({ failed: 1, sent: 0 });
    expect(transport.send).not.toHaveBeenCalled();
    expect(ledger.observe).toHaveBeenCalledWith("delivery", "claim", "failed");
  });
  it("advances an immutable outbox cursor across bounded pages", async () => {
    const ledger = setup();
    const first = Array.from({ length: 100 }, (_, index) => `outbox-${index}`);
    ledger.listDispatchable.mockResolvedValueOnce(first)
      .mockResolvedValueOnce(["outbox-100"]);
    ledger.claim.mockResolvedValue(null);
    const transport = { send: vi.fn() };
    expect(await dispatchMatchedOfferPush({ ledger, transport,
      newClaimId: () => "claim", now })).toEqual({ queued: 1,
      sent: 0, failed: 0, unresolved: 0 });
    expect(ledger.listDispatchable).toHaveBeenNthCalledWith(1, null);
    expect(ledger.listDispatchable).toHaveBeenNthCalledWith(2, "outbox-99");
    expect(ledger.prepare).toHaveBeenCalledTimes(101);
    expect(transport.send).not.toHaveBeenCalled();
  });
});
