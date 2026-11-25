import { createHmac, timingSafeEqual } from "node:crypto";

export type StripeCheckoutHint = { eventId: string; type: string; checkoutId: string };
const accepted = new Set([
  "checkout.session.completed", "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed", "checkout.session.expired",
]);

export function verifyStripeTestCheckoutHint(input: {
  rawBody: Uint8Array; signature: string | null; secret: string;
  now?: () => number;
}): StripeCheckoutHint | null {
  if (!input.secret.startsWith("whsec_") || !input.signature ||
    input.rawBody.byteLength === 0 || input.rawBody.byteLength > 131072)
    return null;
  const entries = input.signature.split(",").map((part) => part.trim());
  const stamps = entries.filter((part) => /^t=\d+$/.test(part));
  const signatures = entries.filter((part) => /^v1=[a-f0-9]{64}$/.test(part));
  if (stamps.length !== 1 || signatures.length === 0) return null;
  const timestamp = Number(stamps[0]?.slice(2));
  const current = Math.floor((input.now ?? Date.now)() / 1000);
  if (!Number.isSafeInteger(timestamp) || Math.abs(current - timestamp) > 300)
    return null;
  const expected = createHmac("sha256", input.secret)
    .update(`${timestamp}.`).update(input.rawBody).digest();
  if (!signatures.some((part) => {
    const given = Buffer.from(part.slice(3), "hex");
    return given.length === expected.length && timingSafeEqual(given, expected);
  })) return null;
  let decoded: unknown;
  try { decoded = JSON.parse(Buffer.from(input.rawBody).toString("utf8")); }
  catch { return null; }
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) return null;
  const event = decoded as Record<string, unknown>;
  if (event.object !== "event" || event.livemode !== false ||
    typeof event.id !== "string" || !/^evt_[A-Za-z0-9_]+$/.test(event.id) ||
    typeof event.type !== "string" || !accepted.has(event.type) ||
    !event.data || typeof event.data !== "object" || Array.isArray(event.data))
    return null;
  const source = (event.data as Record<string, unknown>).object;
  if (!source || typeof source !== "object" || Array.isArray(source)) return null;
  const checkout = source as Record<string, unknown>;
  if (checkout.object !== "checkout.session" || typeof checkout.id !== "string" ||
    !/^cs_test_[A-Za-z0-9_]+$/.test(checkout.id)) return null;
  return { eventId: event.id, type: event.type, checkoutId: checkout.id };
}
