import { describe, expect, it, vi } from "vitest";
import { issueReservedPayout } from "../src/payout.js";

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
    expect(db.reserveSessionPayout).toHaveBeenCalledWith(reservation.sessionId);
    expect(provider.createOrder).toHaveBeenCalledWith({ recipientId: reservation.recipientId,
      productId: reservation.productId, amountCents: reservation.amountCents,
      idempotencyKey: `gate2-payout:${reservation.id}` });
    expect(provider.getOrderByKey).toHaveBeenCalledTimes(2);
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

  it("withholds provider call when reservation fails", async () => {
    const { db, provider } = setup();
    db.reserveSessionPayout.mockRejectedValue(new Error("cap exceeded"));
    expect(await issueReservedPayout(db, provider, reservation.sessionId)).toBe("blocked");
    expect(provider.createOrder).not.toHaveBeenCalled();
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
