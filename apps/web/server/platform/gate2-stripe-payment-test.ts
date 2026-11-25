import type { PaidCheckoutProvider, CheckoutObservation } from "@envoi-labs/services/paid-study";

type Requester = typeof fetch;
type Fields = Record<string, unknown>;
function object(value: unknown): Fields {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid Stripe payment response");
  return value as Fields;
}
function testId(value: unknown, prefix: string): string {
  if (typeof value !== "string" || !new RegExp(`^${prefix}[A-Za-z0-9_]+$`).test(value))
    throw new Error("Invalid Stripe test identity");
  return value;
}

export function createStripeTestPaymentObserver(config: {
  secretKey: string; request?: Requester; now?: () => Date;
}): PaidCheckoutProvider {
  if (!config.secretKey.startsWith("sk_test_")) throw new Error("Test-mode Stripe key required");
  const request = config.request ?? fetch;
  const now = config.now ?? (() => new Date());
  const read = async (url: string): Promise<Fields> => {
    const response = await request(url, { method: "GET",
      headers: { Authorization: `Bearer ${config.secretKey}` } });
    if (!response.ok) throw new Error("Stripe payment observation unavailable");
    return object(await response.json());
  };
  return {
    async getCheckout(checkoutId: string): Promise<CheckoutObservation> {
      const id = testId(checkoutId, "cs_test_");
      const session = await read(`https://api.stripe.com/v1/checkout/sessions/${id}`);
      const metadata = object(session.metadata);
      const amount = session.amount_total;
      const version = Number(metadata.pricingConfigVersion);
      if (session.id !== id || session.object !== "checkout.session" ||
        session.livemode !== false || session.mode !== "payment" ||
        session.currency !== "usd" ||
        typeof amount !== "number" || !Number.isSafeInteger(amount) || amount <= 0 ||
        typeof session.client_reference_id !== "string" ||
        metadata.quoteId !== session.client_reference_id ||
        typeof metadata.studyId !== "string" ||
        !Number.isSafeInteger(version) || version < 1 ||
        !["open", "expired", "complete"].includes(String(session.status)))
        throw new Error("Stripe Session does not match a frozen quote");
      let status: CheckoutObservation["status"] = "pending";
      let refundedCents = 0;
      if (session.status === "expired") status = "failed";
      else if (session.status === "complete") {
        const paymentId = testId(session.payment_intent, "pi_");
        const payment = await read(`https://api.stripe.com/v1/payment_intents/${paymentId}`);
        if (payment.id !== paymentId || payment.object !== "payment_intent" ||
          payment.livemode !== false || payment.currency !== "usd" ||
          payment.amount !== amount || !Number.isSafeInteger(payment.amount_received) ||
          (payment.amount_received as number) < 0 ||
          (payment.amount_received as number) > amount)
          throw new Error("Stripe PaymentIntent does not match Checkout");
        if (payment.status === "succeeded" && session.payment_status === "paid" &&
          payment.amount_received === amount) {
          const refunds = await read(`https://api.stripe.com/v1/refunds?payment_intent=${paymentId}&limit=100`);
          if (refunds.object !== "list" || refunds.has_more !== false ||
            !Array.isArray(refunds.data)) throw new Error("Incomplete refund reconciliation");
          for (const item of refunds.data) {
            const refund = object(item);
            if (refund.object !== "refund" || refund.payment_intent !== paymentId ||
              refund.currency !== "usd" || !Number.isSafeInteger(refund.amount) ||
              (refund.amount as number) <= 0 ||
              refund.status !== "succeeded")
              throw new Error("Uncertain refund state");
            refundedCents += refund.amount as number;
          }
          if (refundedCents > amount) throw new Error("Refund exceeds Checkout amount");
          status = refundedCents > 0 ? "refunded" : "paid";
        } else if (["canceled", "requires_payment_method"].includes(String(payment.status)))
          status = "failed";
      }
      const observedAt = now().toISOString();
      return { id, eventId: `stripe-checkout-state:${id}:${status}:${refundedCents}`,
        studyId: metadata.studyId, quoteId: session.client_reference_id,
        pricingConfigVersion: version, amountCents: amount, currency: "usd",
        status, refundedCents, observedAt };
    },
  };
}
