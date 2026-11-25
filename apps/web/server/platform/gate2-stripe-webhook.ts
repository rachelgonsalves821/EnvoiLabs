import { createHmac, timingSafeEqual } from "node:crypto";

export type StripeCheckoutHint = { eventId: string; type: string; checkoutId: string };
export type StripeRefundHint = { eventId: string; type: string;
  refundId: string; reservationId: string };
type SignatureInput = { rawBody: Uint8Array; signature: string | null;
  secret: string; now?: () => number };
const checkoutEvents = new Set([
  "checkout.session.completed", "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed", "checkout.session.expired",
]);

const refundEvents = new Set(["refund.created", "refund.updated", "refund.failed"]);

function verifiedStripeEvent(input: SignatureInput): {
  eventId: string; type: string; source: Record<string, unknown>
} | null {
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
    typeof event.type !== "string" ||
    !event.data || typeof event.data !== "object" || Array.isArray(event.data))
    return null;
  const source = (event.data as Record<string, unknown>).object;
  if (!source || typeof source !== "object" || Array.isArray(source)) return null;
  return { eventId: event.id, type: event.type,
    source: source as Record<string, unknown> };
}

export function verifyStripeTestCheckoutHint(input: SignatureInput): StripeCheckoutHint | null {
  const event = verifiedStripeEvent(input);
  if (!event || !checkoutEvents.has(event.type)) return null;
  const checkout = event.source;
  if (checkout.object !== "checkout.session" || typeof checkout.id !== "string" ||
    !/^cs_test_[A-Za-z0-9_]+$/.test(checkout.id)) return null;
  return { eventId: event.eventId, type: event.type, checkoutId: checkout.id };
}

export function verifyStripeTestRefundHint(input: SignatureInput): StripeRefundHint | null {
  const event = verifiedStripeEvent(input);
  if (!event || !refundEvents.has(event.type)) return null;
  const refund = event.source;
  if (refund.object !== "refund" || typeof refund.id !== "string" ||
    !/^re_[A-Za-z0-9_]+$/.test(refund.id) ||
    !refund.metadata || typeof refund.metadata !== "object" ||
    Array.isArray(refund.metadata)) return null;
  const reservationId = (refund.metadata as Record<string, unknown>).reservationId;
  if (typeof reservationId !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
      .test(reservationId)) return null;
  return { eventId: event.eventId, type: event.type,
    refundId: refund.id, reservationId };
}
