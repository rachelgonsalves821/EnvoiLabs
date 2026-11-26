import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { verifyTremendousSandboxHint } from "./gate2-tremendous-webhook";
import { createTremendousSandboxOrderResolver,
  reconcileTremendousSandboxHint } from "./gate2-tremendous-webhook-process";

const secret = "synthetic-webhook-secret";
const payoutId = "11111111-1111-4111-8111-111111111111";
const key = `gate2-payout:${payoutId}`;
const resource = { id: "ORDERBATCH1", type: "orders" };
const body = JSON.stringify({ event: "ORDERS.APPROVED",
  uuid: "22222222-2222-4222-8222-222222222222",
  created_utc: "2026-11-25T02:00:00Z", payload: { resource, meta: {} } });
const bytes = (value: string) => new TextEncoder().encode(value);
const sign = (value: string) => `sha256=${createHmac("sha256", secret)
  .update(bytes(value)).digest("hex")}`;
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status,
    headers: { "content-type": "application/json" } });

describe("signed Tremendous TEST webhook", () => {
  it("accepts only the raw signed body and supported order/reward events", () => {
    const hint = verifyTremendousSandboxHint({ rawBody: bytes(body),
      signature: sign(body), secret });
    expect(hint).toEqual({ eventId: "22222222-2222-4222-8222-222222222222",
      kind: "ORDERS.APPROVED", resourceType: "orders", resourceId: "ORDERBATCH1" });
    expect(verifyTremendousSandboxHint({ rawBody: bytes(body + " "),
      signature: sign(body), secret })).toBeNull();
    expect(verifyTremendousSandboxHint({ rawBody: bytes(body),
      signature: null, secret })).toBeNull();
    const unrelated = body.replace("ORDERS.APPROVED", "PRODUCTS.UPDATED");
    expect(verifyTremendousSandboxHint({ rawBody: bytes(unrelated),
      signature: sign(unrelated), secret })).toBeNull();
    const wrongType = body.replace('"type":"orders"', '"type":"rewards"');
    expect(verifyTremendousSandboxHint({ rawBody: bytes(wrongType),
      signature: sign(wrongType), secret })).toBeNull();
  });

  it("resolves reward delivery through current reward and order GETs only", async () => {
    const rewardBody = body.replace("ORDERS.APPROVED", "REWARDS.DELIVERY.SUCCEEDED")
      .replace('"id":"ORDERBATCH1","type":"orders"',
        '"id":"REWARD1","type":"rewards"');
    const hint = verifyTremendousSandboxHint({ rawBody: bytes(rewardBody),
      signature: sign(rewardBody), secret });
    expect(hint?.resourceType).toBe("rewards");
    if (!hint) throw new Error("Signed reward hint absent");
    const request = vi.fn().mockResolvedValueOnce(json({ reward: {
      id: "REWARD1", order_id: "ORDERBATCH1" } }))
      .mockResolvedValueOnce(json({ order: { id: "ORDERBATCH1", external_id: key } }));
    const resolve = createTremendousSandboxOrderResolver({
      apiKey: "TEST_fixture", request });
    expect(await resolve(hint)).toEqual({ id: "ORDERBATCH1", externalId: key });
    expect(request.mock.calls.map(([url, options]) => [url, options.method])).toEqual([
      ["https://testflight.tremendous.com/api/v2/rewards/REWARD1", "GET"],
      ["https://testflight.tremendous.com/api/v2/orders/ORDERBATCH1", "GET"],
    ]);
    expect(() => createTremendousSandboxOrderResolver({ apiKey: "LIVE_wrong" }))
      .toThrow("Sandbox key required");
  });

  it.each([
    { kind: "ORDERS.CREATED", resourceType: "orders", status: "ordered" },
    { kind: "ORDERS.APPROVED", resourceType: "orders", status: "delivered" },
    { kind: "ORDERS.CANCELED", resourceType: "orders", status: "failed" },
    { kind: "ORDERS.FAILED", resourceType: "orders", status: "failed" },
    { kind: "REWARDS.CANCELED", resourceType: "rewards", status: "failed" },
    { kind: "REWARDS.DELIVERY.SUCCEEDED", resourceType: "rewards", status: "delivered" },
    { kind: "REWARDS.DELIVERY.FAILED", resourceType: "rewards", status: "failed" },
  ] as const)("replays three signed $kind hints with one frozen payout effect", async ({
    kind, resourceType, status,
  }) => {
    const signedBody = JSON.stringify({ event: kind,
      uuid: "22222222-2222-4222-8222-222222222222",
      created_utc: "2026-11-25T02:00:00Z",
      payload: { resource: { id: resourceType === "orders" ? "ORDERBATCH1" : "REWARD1",
        type: resourceType }, meta: {} } });
    const hint = verifyTremendousSandboxHint({ rawBody: bytes(signedBody),
      signature: sign(signedBody), secret });
    if (!hint) throw new Error("Signed sandbox hint absent");
    expect(hint).toMatchObject({ kind, resourceType });
    const effects = new Set<string>();
    const claim = { id: payoutId, recipientId: payoutId,
      productId: "sandbox_visa", amountCents: 1500,
      state: "pending" as const, providerOrderId: null };
    const order = { id: "ORDERBATCH1",
      eventId: `gate2-order:ORDERBATCH1:${status}`,
      recipientId: payoutId, productId: "sandbox_visa",
      amountCents: 1500, status,
      observedAt: "2026-11-25T02:00:00Z" };
    const ports = { resolveOrder: vi.fn().mockResolvedValue({
      id: order.id, externalId: key }),
    readClaim: vi.fn().mockResolvedValue(claim),
    getOrderByKey: vi.fn().mockResolvedValue(order),
    recordOrder: vi.fn().mockImplementation(async (_id, value) => {
      effects.add(value.eventId);
    }) };
    for (let attempt = 0; attempt < 3; attempt += 1)
      expect(await reconcileTremendousSandboxHint(hint, ports)).toBe("observed");
    expect(effects.size).toBe(1);
    expect(ports.getOrderByKey).toHaveBeenCalledWith(key, {
      recipientId: payoutId, productId: "sandbox_visa", amountCents: 1500 });
    expect(await reconcileTremendousSandboxHint(hint, {
      ...ports, getOrderByKey: vi.fn().mockResolvedValue({ ...order,
        amountCents: 1501 }),
    })).toBe("unavailable");
    expect(effects.size).toBe(1);
    expect(await reconcileTremendousSandboxHint(hint, {
      ...ports, resolveOrder: vi.fn().mockResolvedValue({
        id: order.id, externalId: "unrelated" }),
    })).toBe("ignored");
  });
});
