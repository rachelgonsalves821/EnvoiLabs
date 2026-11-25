import type { PayoutProvider, ProviderOrder } from "@envoi-labs/services/payout";
import { supportsReservedVisaPayout } from "@envoi-labs/services/visa-product";

type Fields = Record<string, unknown>;
type Expected = { recipientId: string; productId: string; amountCents: number };
type Recipient = { name: string; email: string; country: string };
const object = (value: unknown): value is Fields =>
  value !== null && typeof value === "object" && !Array.isArray(value);
function dollarsToCents(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const cents = Math.round(value * 100);
  return Number.isSafeInteger(cents) && Math.abs(cents / 100 - value) < 0.000001
    ? cents : null;
}
function validKey(key: string) {
  return /^gate2-payout:[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(key);
}
function validRecipient(value: Recipient | null): value is Recipient {
  return !!value && value.name.trim().length >= 2 && value.name.length <= 120 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email) && value.email.length <= 254 &&
    /^[A-Z]{2}$/.test(value.country);
}
function orderFrom(value: unknown): Fields {
  if (!object(value)) throw new Error("Invalid sandbox order");
  const order = object(value.order) ? value.order : value;
  if (!object(order)) throw new Error("Invalid sandbox order");
  return order;
}
function verifiedOrder(value: unknown, key: string, expected: Expected,
  recipient: Recipient, now: () => Date): ProviderOrder {
  const order = orderFrom(value);
  const reward = Array.isArray(order.rewards) && order.rewards.length === 1
    ? order.rewards[0] : null;
  if (typeof order.id !== "string" || !order.id.trim() ||
    order.external_id !== key || !object(reward) ||
    !Array.isArray(reward.products) || reward.products.length !== 1 ||
    reward.products[0] !== expected.productId ||
    !object(reward.value) || reward.value.currency_code !== "USD" ||
    dollarsToCents(reward.value.denomination) !== expected.amountCents ||
    !object(reward.recipient) || reward.recipient.name !== recipient.name ||
    typeof reward.recipient.email !== "string" ||
    reward.recipient.email.toLowerCase() !== recipient.email.toLowerCase() ||
    !object(reward.delivery) || reward.delivery.method !== "EMAIL" ||
    !["OPEN", "EXECUTED", "FAILED", "CANCELED", "PENDING APPROVAL",
      "PENDING INTERNAL PAYMENT APPROVAL", "PENDING SETTLEMENT"].includes(String(order.status)) ||
    !["SCHEDULED", "PENDING", "SUCCEEDED", "FAILED"].includes(String(reward.delivery.status)))
    throw new Error("Sandbox order does not match payout reservation");
  const status = order.status === "FAILED" || order.status === "CANCELED" ||
    reward.delivery.status === "FAILED" ? "failed" :
    order.status === "EXECUTED" && reward.delivery.status === "SUCCEEDED"
      ? "delivered" : "ordered";
  const observedAt = now().toISOString();
  return { id: order.id, eventId: `gate2-order:${order.id}:${order.status}:${reward.delivery.status}`,
    recipientId: expected.recipientId, productId: expected.productId,
    amountCents: expected.amountCents, status, observedAt };
}

export function createTremendousSandboxPayoutProvider(config: {
  apiKey: string;
  recipient: (id: string) => Promise<Recipient | null>;
  request?: typeof fetch;
  now?: () => Date;
}): PayoutProvider {
  if (!config.apiKey.startsWith("TEST_")) throw new Error("Sandbox key required");
  const request = config.request ?? fetch;
  const now = config.now ?? (() => new Date());
  const root = "https://testflight.tremendous.com/api/v2";
  const headers = { Authorization: `Bearer ${config.apiKey}`,
    Accept: "application/json" };
  const readRecipient = async (id: string) => {
    const value = await config.recipient(id);
    if (!validRecipient(value)) throw new Error("Payout recipient unavailable");
    return value;
  };
  return {
    async getOrderByKey(key, expected) {
      if (!validKey(key)) throw new Error("Invalid payout key");
      const recipient = await readRecipient(expected.recipientId);
      const response = await request(`${root}/orders/${encodeURIComponent(key)}`,
        { method: "GET", headers });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error("Sandbox order lookup unavailable");
      return verifiedOrder(await response.json(), key, expected, recipient, now);
    },
    async createOrder(input) {
      if (!validKey(input.idempotencyKey) ||
        !/^[A-Za-z0-9_-]{3,100}$/.test(input.productId) ||
        !Number.isSafeInteger(input.amountCents) || input.amountCents <= 0)
        throw new Error("Invalid sandbox payout intent");
      const recipient = await readRecipient(input.recipientId);
      const catalog = await request(`${root}/products?id=${encodeURIComponent(input.productId)}&country=${recipient.country}&currency=USD`,
        { method: "GET", headers });
      if (!catalog.ok) throw new Error("Visa catalog unavailable");
      const result: unknown = await catalog.json();
      if (!object(result) || !Array.isArray(result.products) ||
        result.products.length !== 1 || !supportsReservedVisaPayout(result.products[0], {
          productId: input.productId, country: recipient.country,
          amountCents: input.amountCents,
        })) throw new Error("Visa product or denomination unavailable");
      const response = await request(`${root}/orders`, {
        method: "POST", headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ external_id: input.idempotencyKey,
          payment: { funding_source_id: "BALANCE" },
          reward: { products: [input.productId],
            value: { denomination: input.amountCents / 100, currency_code: "USD" },
            recipient: { name: recipient.name, email: recipient.email },
            delivery: { method: "EMAIL" } } }),
      });
      if (!response.ok) throw new Error("Sandbox order create unavailable");
    },
  };
}
