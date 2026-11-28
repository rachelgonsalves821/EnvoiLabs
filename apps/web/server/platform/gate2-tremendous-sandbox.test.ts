import { describe, expect, it, vi } from "vitest";
import { issueReservedPayout } from "@envoi-labs/services/payout";
import { createTremendousSandboxPayoutProvider } from "./gate2-tremendous-sandbox";

const id = "11111111-1111-4111-8111-111111111111";
const key = `gate2-payout:${id}`;
const expected = { recipientId: "respondent-1", productId: "sandbox-visa",
  amountCents: 1000 };
const recipient = { name: "Synthetic Person", email: "synthetic@example.test",
  country: "US" };
const product = { id: "sandbox-visa", category: "visa_card",
  currency_codes: ["USD"], countries: [{ abbr: "US" }],
  skus: [{ min: 10, max: 500, currency_code: "USD" }] };
const order = { id: "ORDER-1", external_id: key, status: "EXECUTED",
  created_at: "2026-11-25T02:00:00Z",
  rewards: [{ products: ["sandbox-visa"],
    value: { denomination: 10, currency_code: "USD" },
    recipient: { name: recipient.name, email: recipient.email },
    delivery: { method: "EMAIL", status: "SUCCEEDED" } }] };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const make = (request: typeof fetch, resolved = recipient) =>
  createTremendousSandboxPayoutProvider({ apiKey: "TEST_fixture",
    recipient: vi.fn().mockResolvedValue(resolved), request });

describe("Tremendous sandbox Visa adapter", () => {
  it("requires a sandbox key and exact private recipient before any request", async () => {
    expect(() => createTremendousSandboxPayoutProvider({ apiKey: "LIVE_bad",
      recipient: async () => recipient })).toThrow("Sandbox key");
    const request = vi.fn() as unknown as typeof fetch;
    const provider = make(request, null as unknown as typeof recipient);
    await expect(provider.getOrderByKey(key, expected)).rejects.toThrow("recipient");
    expect(request).not.toHaveBeenCalled();
  });

  it("looks up the durable external ID and verifies exact order identity", async () => {
    const request = vi.fn().mockResolvedValueOnce(json({ order }));
    const provider = make(request);
    expect(await provider.getOrderByKey(key, expected)).toEqual({ id: "ORDER-1",
      eventId: "gate2-order:ORDER-1:EXECUTED:SUCCEEDED",
      recipientId: expected.recipientId, productId: expected.productId,
      amountCents: 1000, status: "delivered",
      observedAt: "2026-11-25T02:00:00.000Z" });
    expect(request).toHaveBeenCalledWith(
      `https://testflight.tremendous.com/api/v2/orders/${encodeURIComponent(key)}`,
      expect.objectContaining({ method: "GET" }));
  });

  it("keeps the same event timestamp when an ordered status is read twice", async () => {
    const pending = { ...order, status: "OPEN", rewards: [{ ...order.rewards[0],
      delivery: { method: "EMAIL", status: "PENDING" } }] };
    const provider = make(vi.fn().mockImplementation(async () => json({ order: pending })));
    const first = await provider.getOrderByKey(key, expected);
    const replay = await provider.getOrderByKey(key, expected);
    expect(first).toEqual(replay);
    expect(first?.observedAt).toBe("2026-11-25T02:00:00.000Z");
  });

  it("treats a verified 404 as absent but all uncertain reads as unavailable", async () => {
    const request = vi.fn().mockResolvedValueOnce(json({}, 404))
      .mockResolvedValueOnce(json({}, 500));
    const provider = make(request);
    expect(await provider.getOrderByKey(key, expected)).toBeNull();
    await expect(provider.getOrderByKey(key, expected)).rejects.toThrow("lookup");
  });

  it("blocks a mismatched amount, product, recipient or external ID", async () => {
    const changes = [
      { ...order, external_id: "other" },
      { ...order, rewards: [{ ...order.rewards[0], products: ["other"] }] },
      { ...order, rewards: [{ ...order.rewards[0],
        value: { denomination: 11, currency_code: "USD" } }] },
      { ...order, rewards: [{ ...order.rewards[0],
        recipient: { ...recipient, email: "wrong@example.test" } }] },
    ];
    for (const changed of changes) {
      const provider = make(vi.fn().mockResolvedValue(json({ order: changed })));
      await expect(provider.getOrderByKey(key, expected)).rejects.toThrow("does not match");
    }
  });

  it("checks current account Visa catalog and sends only the frozen email reward", async () => {
    const request = vi.fn().mockResolvedValueOnce(json({ products: [product] }))
      .mockResolvedValueOnce(json({ order }));
    const provider = make(request);
    await provider.createOrder({ ...expected, idempotencyKey: key });
    expect(request).toHaveBeenCalledTimes(2);
    const [, init] = request.mock.calls[1]!;
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ external_id: key,
      payment: { funding_source_id: "BALANCE" },
      reward: { products: ["sandbox-visa"],
        value: { denomination: 10, currency_code: "USD" },
        recipient: { name: recipient.name, email: recipient.email },
        delivery: { method: "EMAIL" } } });
  });

  it("refuses a $1 reward below the synthetic Visa minimum without creating an order", async () => {
    const request = vi.fn().mockResolvedValue(json({ products: [product] }));
    const provider = make(request);
    await expect(provider.createOrder({ ...expected, amountCents: 100,
      idempotencyKey: key })).rejects.toThrow("denomination");
    expect(request).toHaveBeenCalledOnce();
  });

  it("reconciles an uncertain create and delivered retries by one durable key", async () => {
    const request = vi.fn().mockResolvedValueOnce(json({}, 404))
      .mockResolvedValueOnce(json({ products: [product] }))
      .mockRejectedValueOnce(new Error("timeout after provider accepted order"))
      .mockResolvedValueOnce(json({ order }));
    const provider = make(request);
    const reserved = { id, sessionId: "session-1", respondentId: "respondent-1",
      ...expected, state: "pending" as const, providerOrderId: null };
    const db = { reserveSessionPayout: vi.fn().mockResolvedValueOnce(reserved)
      .mockResolvedValue({ ...reserved, state: "delivered", providerOrderId: order.id }),
      claimIssuer: vi.fn().mockResolvedValue(true),
      recordOrder: vi.fn().mockResolvedValue(undefined) };
    expect(await issueReservedPayout(db, provider, reserved.sessionId)).toBe("delivered");
    expect(await issueReservedPayout(db, provider, reserved.sessionId)).toBe("delivered");
    expect(await issueReservedPayout(db, provider, reserved.sessionId)).toBe("delivered");
    expect(request).toHaveBeenCalledTimes(4);
    expect(request.mock.calls.filter(([url]) => url ===
      "https://testflight.tremendous.com/api/v2/orders")).toHaveLength(1);
    expect(db.recordOrder).toHaveBeenCalledOnce();
    expect(db.recordOrder).toHaveBeenCalledWith(id, expect.objectContaining({
      id: order.id, status: "delivered", amountCents: 1000 }));
  });
});
