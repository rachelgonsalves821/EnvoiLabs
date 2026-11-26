import type { ProviderOrder } from "@envoi-labs/services/payout";
import type { TremendousSandboxHint } from "./gate2-tremendous-webhook";

export type SandboxWebhookClaim = {
  id: string; recipientId: string; productId: string; amountCents: number;
  state: "pending" | "ordered" | "delivered" | "failed";
  providerOrderId: string | null;
};
type OrderIdentity = { id: string; externalId: string };
export type SandboxWebhookPorts = {
  resolveOrder(hint: TremendousSandboxHint): Promise<OrderIdentity>;
  readClaim(payoutId: string): Promise<SandboxWebhookClaim | null>;
  getOrderByKey(key: string, expected: { recipientId: string;
    productId: string; amountCents: number }): Promise<ProviderOrder | null>;
  recordOrder(payoutId: string, order: ProviderOrder): Promise<void>;
};
const payoutKey = /^gate2-payout:([a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$/i;

// The signed webhook supplies only an identity. Current provider state and the
// frozen local intent, including recipient/SKU/amount, decide the effect.
export async function reconcileTremendousSandboxHint(
  hint: TremendousSandboxHint, ports: SandboxWebhookPorts,
): Promise<"ignored" | "observed" | "unavailable"> {
  try {
    const identity = await ports.resolveOrder(hint);
    const match = payoutKey.exec(identity.externalId);
    if (!match) return "ignored";
    const payoutId = match[1]!;
    const claim = await ports.readClaim(payoutId);
    if (!claim) return "ignored";
    if (claim.id !== payoutId || claim.recipientId !== payoutId ||
      !Number.isSafeInteger(claim.amountCents) || claim.amountCents <= 0 ||
      !claim.productId ||
      (claim.providerOrderId !== null && claim.providerOrderId !== identity.id))
      return "unavailable";
    const current = await ports.getOrderByKey(identity.externalId, {
      recipientId: claim.recipientId, productId: claim.productId,
      amountCents: claim.amountCents,
    });
    if (!current || current.id !== identity.id ||
      current.recipientId !== payoutId ||
      current.productId !== claim.productId ||
      current.amountCents !== claim.amountCents) return "unavailable";
    await ports.recordOrder(payoutId, current);
    return "observed";
  } catch { return "unavailable"; }
}

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const providerId = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Z0-9]{4,20}$/.test(value);

// This resolver is GET-only and accepts only the testflight host and TEST_ key.
export function createTremendousSandboxOrderResolver(input: {
  apiKey: string; request?: typeof fetch;
}) {
  if (!input.apiKey.startsWith("TEST_")) throw new Error("Sandbox key required");
  const request = input.request ?? fetch;
  const root = "https://testflight.tremendous.com/api/v2";
  const headers = { Authorization: `Bearer ${input.apiKey}`, Accept: "application/json" };
  const get = async (resource: "orders" | "rewards", id: string) => {
    const response = await request(`${root}/${resource}/${encodeURIComponent(id)}`,
      { method: "GET", headers });
    if (!response.ok) throw new Error("Sandbox webhook resource unavailable");
    const payload: unknown = await response.json();
    if (!object(payload)) throw new Error("Invalid sandbox webhook resource");
    const value = object(payload[resource.slice(0, -1)])
      ? payload[resource.slice(0, -1)] : payload;
    if (!object(value) || value.id !== id) throw new Error("Wrong sandbox webhook resource");
    return value;
  };
  return async (hint: TremendousSandboxHint): Promise<OrderIdentity> => {
    let orderId = hint.resourceId;
    if (hint.resourceType === "rewards") {
      const reward = await get("rewards", hint.resourceId);
      if (!providerId(reward.order_id)) throw new Error("Reward order unavailable");
      orderId = reward.order_id;
    }
    const order = await get("orders", orderId);
    if (typeof order.external_id !== "string")
      throw new Error("Order external identity unavailable");
    return { id: orderId, externalId: order.external_id };
  };
}
