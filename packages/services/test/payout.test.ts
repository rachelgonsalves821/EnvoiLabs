import { describe, expect, it, vi } from "vitest";
import { issueReservedBatchPayout, issueReservedPayout,
  PayoutReservationDenied } from "../src/payout.js";

const reservation = { id: "pay_fixture_1", sessionId: "session_1", respondentId: "respondent_1",
  recipientId: "recipient_1", productId: "us-visa", amountCents: 500,
  state: "pending" as const, providerOrderId: null };
const order = { id: "gift_fixture_1", eventId: "evt_ordered_1", recipientId: reservation.recipientId,
  productId: reservation.productId, amountCents: reservation.amountCents,
  status: "ordered" as const, observedAt: "2026-11-23T20:00:00.000Z" };

function setup() {
  const db = { reserveSessionPayout: vi.fn().mockResolvedValue(reservation),
    recordOrder: vi.fn().mockResolvedValue(undefined) };
  const provider = { createOrder: vi.fn().mockResolvedValue(undefined),
    getOrderByKey: vi.fn().mockResolvedValueOnce(null).mockResolvedValue(order) };
  return { db, provider };
}

describe("payout issue and reconciliation", () => {
  it("reserves before provider call and uses the reservation as provider key", async () => {
    const { db, provider } = setup();
    expect(await issueReservedPayout(db, provider, reservation.sessionId)).toBe("ordered");
    expect(db.reserveSessionPayout).toHaveBeenCalledWith(reservation.sessionId,
      `payout:${reservation.sessionId}`);
    expect(provider.createOrder).toHaveBeenCalledWith({ recipientId: reservation.recipientId,
      productId: reservation.productId, amountCents: reservation.amountCents,
      idempotencyKey: `gate2-payout:${reservation.id}` });
    expect(provider.getOrderByKey).toHaveBeenCalledTimes(2);
    expect(provider.getOrderByKey).toHaveBeenCalledWith(`gate2-payout:${reservation.id}`,
      { recipientId: reservation.recipientId, productId: reservation.productId,
        amountCents: reservation.amountCents });
    expect(db.recordOrder).toHaveBeenCalledWith(reservation.id, order);
  });

  it("reconciles an uncertain provider create by stable key", async () => {
    const { db, provider } = setup();
    provider.createOrder.mockRejectedValue(new Error("timeout after creation"));
    expect(await issueReservedPayout(db, provider, reservation.sessionId)).toBe("ordered");
    expect(db.recordOrder).toHaveBeenCalledOnce();
  });

  it("same-session retry keeps one provider key and prior decision", async () => {
    const { db, provider } = setup();
    db.reserveSessionPayout.mockResolvedValueOnce(reservation).mockResolvedValue({
      ...reservation, state: "ordered", providerOrderId: order.id });
    expect(await issueReservedPayout(db, provider, reservation.sessionId)).toBe("ordered");
    expect(await issueReservedPayout(db, provider, reservation.sessionId)).toBe("ordered");
    expect(provider.createOrder).toHaveBeenCalledOnce();
    expect(provider.getOrderByKey).toHaveBeenCalledTimes(3);
  });

  it("delivered retry never calls provider create or read", async () => {
    const { db, provider } = setup();
    db.reserveSessionPayout.mockResolvedValue({ ...reservation,
      state: "delivered", providerOrderId: order.id });
    expect(await issueReservedPayout(db, provider, reservation.sessionId)).toBe("delivered");
    expect(provider.createOrder).not.toHaveBeenCalled();
    expect(provider.getOrderByKey).not.toHaveBeenCalled();
  });

  it("uncertain create followed by retry finds prior provider order without creating again", async () => {
    const { db, provider } = setup();
    provider.createOrder.mockRejectedValue(new Error("timeout after creation"));
    db.reserveSessionPayout.mockResolvedValue(reservation);
    expect(await issueReservedPayout(db, provider, reservation.sessionId)).toBe("ordered");
    expect(await issueReservedPayout(db, provider, reservation.sessionId)).toBe("ordered");
    expect(provider.createOrder).toHaveBeenCalledOnce();
  });

  it.each([
    { recipientId: "wrong" }, { productId: "wrong" }, { amountCents: 501 },
    { id: "" }, { eventId: "" }, { observedAt: "invalid" },
  ])("blocks mismatched provider order: %j", async (change) => {
    const { db, provider } = setup();
    provider.getOrderByKey.mockResolvedValue({ ...order, ...change });
    expect(await issueReservedPayout(db, provider, reservation.sessionId)).toBe("blocked");
    expect(db.recordOrder).not.toHaveBeenCalled();
  });

  it("blocks a policy denial before any provider call", async () => {
    const { db, provider } = setup();
    db.reserveSessionPayout.mockRejectedValue(new PayoutReservationDenied());
    expect(await issueReservedPayout(db, provider, reservation.sessionId)).toBe("blocked");
    expect(provider.createOrder).not.toHaveBeenCalled();
    expect(provider.getOrderByKey).not.toHaveBeenCalled();
  });

  it("keeps the original reservation key for retry after a transient database error", async () => {
    const { db, provider } = setup();
    db.reserveSessionPayout.mockRejectedValueOnce(new Error("database timeout"))
      .mockResolvedValueOnce(reservation);
    expect(await issueReservedPayout(db, provider, reservation.sessionId)).toBe("unavailable");
    expect(provider.createOrder).not.toHaveBeenCalled();
    expect(provider.getOrderByKey).not.toHaveBeenCalled();
    expect(await issueReservedPayout(db, provider, reservation.sessionId)).toBe("ordered");
    expect(db.reserveSessionPayout).toHaveBeenNthCalledWith(1, reservation.sessionId,
      `payout:${reservation.sessionId}`);
    expect(db.reserveSessionPayout).toHaveBeenNthCalledWith(2, reservation.sessionId,
      `payout:${reservation.sessionId}`);
    expect(provider.createOrder).toHaveBeenCalledOnce();
  });

  it("leaves an uncertain order pending when provider state cannot be fetched", async () => {
    const { db, provider } = setup();
    provider.createOrder.mockRejectedValue(new Error("timeout"));
    provider.getOrderByKey.mockReset().mockResolvedValue(null);
    expect(await issueReservedPayout(db, provider, reservation.sessionId)).toBe("unavailable");
    expect(db.recordOrder).not.toHaveBeenCalled();
  });

  it("does not create when the provider lookup is unavailable", async () => {
    const { db, provider } = setup();
    provider.getOrderByKey.mockReset().mockRejectedValue(new Error("lookup timeout"));
    expect(await issueReservedPayout(db, provider, reservation.sessionId)).toBe("unavailable");
    expect(provider.createOrder).not.toHaveBeenCalled();
  });
});

describe("aggregated Visa batch issue", () => {
  const batch = { id: reservation.id, batchId: "batch_fixture_1",
    respondentId: reservation.respondentId, recipientId: reservation.recipientId,
    productId: reservation.productId, amountCents: reservation.amountCents,
    state: "pending" as const, providerOrderId: null };
  it("does not contact the provider below the account Visa minimum", async () => {
    const db = { reserveBatchPayout: vi.fn().mockResolvedValue({ status: "below_minimum" }),
      recordOrder: vi.fn() };
    const provider = { createOrder: vi.fn(), getOrderByKey: vi.fn() };
    expect(await issueReservedBatchPayout(db, provider,
      batch.respondentId, "stable-request")).toBe("below_minimum");
    expect(db.reserveBatchPayout).toHaveBeenCalledWith(batch.respondentId, "stable-request");
    expect(provider.createOrder).not.toHaveBeenCalled();
    expect(provider.getOrderByKey).not.toHaveBeenCalled();
  });

  it("reconciles an uncertain create and delivered retry with one payout key", async () => {
    const db = { reserveBatchPayout: vi.fn().mockResolvedValueOnce(batch)
      .mockResolvedValue({ ...batch, state: "delivered", providerOrderId: order.id }),
      recordOrder: vi.fn().mockResolvedValue(undefined) };
    const provider = { createOrder: vi.fn().mockRejectedValue(new Error("timeout")),
      getOrderByKey: vi.fn().mockResolvedValueOnce(null).mockResolvedValue(order) };
    expect(await issueReservedBatchPayout(db, provider,
      batch.respondentId, "stable-request")).toBe("ordered");
    expect(await issueReservedBatchPayout(db, provider,
      batch.respondentId, "stable-request")).toBe("delivered");
    expect(provider.createOrder).toHaveBeenCalledOnce();
    expect(provider.createOrder).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: `gate2-payout:${batch.id}` }));
    expect(db.recordOrder).toHaveBeenCalledOnce();
  });

  it("distinguishes a denied batch from a transient database outage", async () => {
    const db = { reserveBatchPayout: vi.fn()
      .mockRejectedValueOnce(new PayoutReservationDenied())
      .mockRejectedValueOnce(new Error("database timeout")),
    recordOrder: vi.fn() };
    const provider = { createOrder: vi.fn(), getOrderByKey: vi.fn() };
    expect(await issueReservedBatchPayout(db, provider,
      batch.respondentId, "stable-request")).toBe("blocked");
    expect(await issueReservedBatchPayout(db, provider,
      batch.respondentId, "stable-request")).toBe("unavailable");
    expect(provider.getOrderByKey).not.toHaveBeenCalled();
    expect(provider.createOrder).not.toHaveBeenCalled();
  });
});
