export type Reservation = {
  id: string;
  sessionId: string;
  respondentId: string;
  recipientId: string;
  productId: string;
  amountCents: number;
  state: "pending" | "ordered" | "delivered" | "failed";
  providerOrderId: string | null;
};
export type BatchReservation = Omit<Reservation, "sessionId"> & {
  batchId: string;
};
export type ProviderOrder = {
  id: string;
  eventId: string;
  recipientId: string;
  productId: string;
  amountCents: number;
  status: "ordered" | "delivered" | "failed";
  observedAt: string;
};
export type PayoutDatabase = {
  // The reservation implementation must call the respondent-locked Gate 2 RPC
  // and derive recipient, product and amount from the approved session/config.
  // An exact retry must pass the same key, including after a transient error.
  reserveSessionPayout(sessionId: string, reservationKey: string): Promise<Reservation>;
  claimIssuer(payoutId: string): Promise<boolean>;
  // The writer must deduplicate providerEventId and update payout state under
  // a payout lock. A duplicate exact observation returns the prior result.
  recordOrder(payoutId: string, observation: ProviderOrder): Promise<void>;
};
export type PayoutBatchDatabase = {
  reserveBatchPayout(respondentId: string, requestId: string): Promise<
    BatchReservation | { status: "below_minimum" }>;
  claimIssuer(payoutId: string): Promise<boolean>;
  recordOrder(payoutId: string, observation: ProviderOrder): Promise<void>;
};
export type ReferralReservation = Omit<Reservation, "sessionId"> & {
  vestingId: string;
};
export type PayoutReferralDatabase = {
  reserveReferralPayout(vestingId: string): Promise<
    ReferralReservation | { status: "below_minimum" }>;
  claimIssuer(payoutId: string): Promise<boolean>;
  recordOrder(payoutId: string, observation: ProviderOrder): Promise<void>;
};
export class PayoutReservationDenied extends Error {
  constructor() { super("Payout reservation denied"); }
}
export type PayoutProvider = {
  createOrder(input: { recipientId: string; productId: string;
    amountCents: number; idempotencyKey: string }): Promise<void>;
  getOrderByKey(idempotencyKey: string, expected: {
    recipientId: string; productId: string; amountCents: number;
  }): Promise<ProviderOrder | null>;
};

export async function issueReservedPayout(
  db: PayoutDatabase, provider: PayoutProvider, sessionId: string,
): Promise<"ordered" | "delivered" | "failed" | "blocked" | "unavailable"> {
  let reserved: Reservation;
  const reservationKey = `payout:${sessionId}`;
  try {
    reserved = await db.reserveSessionPayout(sessionId, reservationKey);
  } catch (error) {
    return error instanceof PayoutReservationDenied ? "blocked" : "unavailable";
  }
  if (reserved.sessionId !== sessionId || !Number.isSafeInteger(reserved.amountCents) ||
      reserved.amountCents <= 0 || !reserved.id || !reserved.recipientId || !reserved.productId) {
    return "blocked";
  }
  return reconcileReservedPayout(db, provider, reserved);
}

export async function issueReservedBatchPayout(db: PayoutBatchDatabase,
  provider: PayoutProvider, respondentId: string, requestId: string): Promise<
  "ordered" | "delivered" | "failed" | "below_minimum" | "blocked" | "unavailable"> {
  let reserved: BatchReservation | { status: "below_minimum" };
  try {
    reserved = await db.reserveBatchPayout(respondentId, requestId);
  } catch (error) {
    return error instanceof PayoutReservationDenied ? "blocked" : "unavailable";
  }
  if ("status" in reserved)
    return reserved.status === "below_minimum" ? "below_minimum" : "unavailable";
  if (reserved.respondentId !== respondentId || !reserved.batchId ||
      reserved.recipientId !== reserved.id ||
      !Number.isSafeInteger(reserved.amountCents) || reserved.amountCents <= 0 ||
      !reserved.id || !reserved.recipientId || !reserved.productId) return "blocked";
  return reconcileReservedPayout(db, provider, reserved);
}

export async function issueReservedReferralPayout(db: PayoutReferralDatabase,
  provider: PayoutProvider, vestingId: string): Promise<
  "ordered" | "delivered" | "failed" | "below_minimum" | "blocked" | "unavailable"> {
  let reserved: ReferralReservation | { status: "below_minimum" };
  try {
    reserved = await db.reserveReferralPayout(vestingId);
  } catch (error) {
    return error instanceof PayoutReservationDenied ? "blocked" : "unavailable";
  }
  if ("status" in reserved)
    return reserved.status === "below_minimum" ? "below_minimum" : "unavailable";
  if (reserved.vestingId !== vestingId || reserved.recipientId !== reserved.id ||
      reserved.amountCents !== 500 || !reserved.id || !reserved.respondentId ||
      !reserved.productId) return "blocked";
  return reconcileReservedPayout(db, provider, reserved);
}

async function reconcileReservedPayout(db: Pick<PayoutDatabase, "recordOrder" | "claimIssuer">,
  provider: PayoutProvider, reserved: Omit<Reservation, "sessionId">): Promise<
  "ordered" | "delivered" | "failed" | "blocked" | "unavailable"> {
  if (reserved.state === "delivered" || reserved.state === "failed") return reserved.state;
  try {
    if (!await db.claimIssuer(reserved.id)) return "blocked";
  } catch { return "unavailable"; }
  const key = `gate2-payout:${reserved.id}`;
  const expected = { recipientId: reserved.recipientId,
    productId: reserved.productId, amountCents: reserved.amountCents };
  let observed: ProviderOrder | null;
  try {
    observed = await provider.getOrderByKey(key, expected);
  } catch {
    return "unavailable";
  }
  if (!observed) {
    if (reserved.state !== "pending" || reserved.providerOrderId) return "unavailable";
    try {
      await provider.createOrder({ recipientId: reserved.recipientId,
        productId: reserved.productId, amountCents: reserved.amountCents, idempotencyKey: key });
    } catch {
      // The provider may have created the order before this request timed out.
    }
    try {
      observed = await provider.getOrderByKey(key, expected);
    } catch {
      return "unavailable";
    }
  }
  if (!observed) return "unavailable";
  if (!observed.id || !observed.eventId ||
      (reserved.providerOrderId !== null && reserved.providerOrderId !== observed.id) ||
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
