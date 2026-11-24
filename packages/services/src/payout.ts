type Reservation = {
  id: string;
  sessionId: string;
  respondentId: string;
  recipientId: string;
  productId: string;
  amountCents: number;
};
type ProviderOrder = {
  id: string;
  eventId: string;
  recipientId: string;
  productId: string;
  amountCents: number;
  status: "ordered" | "delivered" | "failed";
  observedAt: string;
};
type PayoutDatabase = {
  // The reservation implementation must call the respondent-locked Gate 2 RPC
  // and derive recipient, product and amount from the approved session/config.
  reserveSessionPayout(sessionId: string): Promise<Reservation>;
  // The writer must deduplicate providerEventId and update payout state under
  // a payout lock. A duplicate exact observation returns the prior result.
  recordOrder(payoutId: string, observation: ProviderOrder): Promise<void>;
};
type PayoutProvider = {
  createOrder(input: { recipientId: string; productId: string;
    amountCents: number; idempotencyKey: string }): Promise<void>;
  getOrderByKey(idempotencyKey: string): Promise<ProviderOrder | null>;
};

export async function issueReservedPayout(
  db: PayoutDatabase, provider: PayoutProvider, sessionId: string,
): Promise<"ordered" | "delivered" | "failed" | "blocked" | "unavailable"> {
  let reserved: Reservation;
  try {
    reserved = await db.reserveSessionPayout(sessionId);
  } catch {
    return "blocked";
  }
  if (reserved.sessionId !== sessionId || !Number.isSafeInteger(reserved.amountCents) ||
      reserved.amountCents <= 0 || !reserved.id || !reserved.recipientId || !reserved.productId) {
    return "blocked";
  }
  const key = `gate2-payout:${reserved.id}`;
  try {
    await provider.createOrder({ recipientId: reserved.recipientId,
      productId: reserved.productId, amountCents: reserved.amountCents, idempotencyKey: key });
  } catch {
    // A timed-out request can still have created an order. The stable key lets
    // us ask the provider before considering any new attempt.
  }

  let observed: ProviderOrder | null;
  try {
    observed = await provider.getOrderByKey(key);
  } catch {
    return "unavailable";
  }
  if (!observed) return "unavailable";
  if (!observed.id || !observed.eventId ||
      observed.recipientId !== reserved.recipientId ||
      observed.productId !== reserved.productId ||
      observed.amountCents !== reserved.amountCents ||
      !Number.isFinite(Date.parse(observed.observedAt))) return "blocked";

  try {
    await db.recordOrder(reserved.id, observed);
  } catch {
    return "unavailable";
  }
  return observed.status;
}
