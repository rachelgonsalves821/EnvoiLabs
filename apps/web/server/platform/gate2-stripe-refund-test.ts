type Fields = Record<string, unknown>;
type Requester = typeof fetch;
export type TestRefundIntent = {
  reservationId: string; studyId: string; quoteId: string;
  checkoutId: string; amountCents: number; quoteTotalCents: number;
  pricingConfigVersion: number; key: string;
};
export type TestRefundObservation = {
  refundId: string; kind: "pending" | "succeeded" | "failed";
  amountCents: number; observedAt: string;
};

function object(value: unknown): Fields {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid Stripe refund response");
  return value as Fields;
}
function id(value: unknown, prefix: string): string {
  if (typeof value !== "string" || !new RegExp(`^${prefix}[A-Za-z0-9_]+$`).test(value))
    throw new Error("Invalid Stripe test identity");
  return value;
}

export function createStripeTestRefundProvider(config: {
  secretKey: string; request?: Requester; now?: () => Date;
}) {
  if (!config.secretKey.startsWith("sk_test_"))
    throw new Error("Test-mode Stripe key required");
  const request = config.request ?? fetch;
  const now = config.now ?? (() => new Date());
  const read = async (url: string): Promise<Fields> => {
    const response = await request(url, { method: "GET",
      headers: { Authorization: `Bearer ${config.secretKey}` } });
    if (!response.ok) throw new Error("Stripe refund observation unavailable");
    return object(await response.json());
  };
  const paymentId = async (intent: TestRefundIntent): Promise<string> => {
    id(intent.checkoutId, "cs_test_");
    if (!Number.isSafeInteger(intent.amountCents) || intent.amountCents <= 0 ||
      intent.key !== `gate2-unfilled-refund:${intent.quoteId}`)
      throw new Error("Invalid frozen refund intent");
    const session = await read(`https://api.stripe.com/v1/checkout/sessions/${intent.checkoutId}`);
    const metadata = object(session.metadata);
    if (session.object !== "checkout.session" || session.id !== intent.checkoutId ||
      session.livemode !== false || session.status !== "complete" ||
      session.payment_status !== "paid" || session.mode !== "payment" ||
      session.currency !== "usd" || session.client_reference_id !== intent.quoteId ||
      metadata.quoteId !== intent.quoteId || metadata.studyId !== intent.studyId ||
      Number(metadata.pricingConfigVersion) !== intent.pricingConfigVersion ||
      !Number.isSafeInteger(session.amount_total) ||
      session.amount_total !== intent.quoteTotalCents ||
      intent.amountCents > intent.quoteTotalCents)
      throw new Error("Stripe Checkout does not match refund reservation");
    const payment = id(session.payment_intent, "pi_");
    const actual = await read(`https://api.stripe.com/v1/payment_intents/${payment}`);
    if (actual.object !== "payment_intent" || actual.id !== payment ||
      actual.livemode !== false || actual.status !== "succeeded" ||
      actual.currency !== "usd" || actual.amount !== session.amount_total ||
      actual.amount_received !== session.amount_total)
      throw new Error("Stripe PaymentIntent does not match Checkout");
    return payment;
  };
  const verified = (value: unknown, intent: TestRefundIntent,
    payment: string): TestRefundObservation => {
    const refund = object(value);
    const metadata = object(refund.metadata);
    const refundId = id(refund.id, "re_");
    if (refund.object !== "refund" || refund.payment_intent !== payment ||
      refund.currency !== "usd" || refund.amount !== intent.amountCents ||
      metadata.reservationId !== intent.reservationId ||
      metadata.quoteId !== intent.quoteId || metadata.studyId !== intent.studyId ||
      !["pending", "succeeded", "failed"].includes(String(refund.status)))
      throw new Error("Stripe refund does not match reservation");
    return { refundId, kind: refund.status as TestRefundObservation["kind"],
      amountCents: intent.amountCents, observedAt: now().toISOString() };
  };
  return {
    async create(intent: TestRefundIntent): Promise<TestRefundObservation> {
      const payment = await paymentId(intent);
      const list = await read(`https://api.stripe.com/v1/refunds?payment_intent=${payment}&limit=100`);
      if (list.object !== "list" || list.has_more !== false || !Array.isArray(list.data))
        throw new Error("Incomplete Stripe refund reconciliation");
      if (list.data.length > 1) throw new Error("Unexpected existing refunds");
      if (list.data.length === 1) return verified(list.data[0], intent, payment);
      const form = new URLSearchParams({ payment_intent: payment,
        amount: String(intent.amountCents),
        "metadata[reservationId]": intent.reservationId,
        "metadata[quoteId]": intent.quoteId,
        "metadata[studyId]": intent.studyId });
      const response = await request("https://api.stripe.com/v1/refunds", {
        method: "POST", headers: {
          Authorization: `Bearer ${config.secretKey}`,
          "Idempotency-Key": intent.key,
          "Content-Type": "application/x-www-form-urlencoded",
        }, body: form });
      if (!response.ok) throw new Error("Stripe refund creation unavailable");
      return verified(await response.json(), intent, payment);
    },
    async get(refundId: string, intent: TestRefundIntent): Promise<TestRefundObservation> {
      id(refundId, "re_");
      const payment = await paymentId(intent);
      const refund = await read(`https://api.stripe.com/v1/refunds/${refundId}`);
      const observation = verified(refund, intent, payment);
      if (observation.refundId !== refundId) throw new Error("Stripe refund identity mismatch");
      return observation;
    },
  };
}
