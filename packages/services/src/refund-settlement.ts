export type RefundIntent = {
  reservationId: string; studyId: string; quoteId: string;
  checkoutId: string; amountCents: number; quoteTotalCents: number;
  pricingConfigVersion: number; key: string;
};
export type RefundObservation = {
  refundId: string; kind: "pending" | "succeeded" | "failed";
  amountCents: number; observedAt: string;
};
export type RefundClaim =
  | { status: "blocked" }
  | { status: "unavailable" }
  | { status: "create"; checkoutId: string; amountCents: number;
      quoteId: string; studyId: string; quoteTotalCents: number;
      pricingConfigVersion: number; key: string }
  | { status: "known"; checkoutId: string; amountCents: number;
      refundId: string; quoteId: string; studyId: string;
      quoteTotalCents: number; pricingConfigVersion: number };
export type RefundSettlementDatabase = {
  claim(reservationId: string, authUserId: string): Promise<RefundClaim>;
  record(reservationId: string, observation: RefundObservation): Promise<boolean>;
};
export type RefundSettlementProvider = {
  create(intent: RefundIntent): Promise<RefundObservation>;
  get(refundId: string, intent: RefundIntent): Promise<RefundObservation>;
};

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export async function settleReservedRefund(input: {
  reservationId: string; authUserId: string;
  database: RefundSettlementDatabase; provider: RefundSettlementProvider;
}) {
  if (!uuid.test(input.reservationId) || !uuid.test(input.authUserId))
    return { status: "blocked" } as const;
  try {
    const claim = await input.database.claim(input.reservationId, input.authUserId);
    if (claim.status === "blocked" || claim.status === "unavailable") return claim;
    if (!uuid.test(claim.studyId) || !uuid.test(claim.quoteId) ||
      !Number.isSafeInteger(claim.amountCents) || claim.amountCents <= 0 ||
      !Number.isSafeInteger(claim.quoteTotalCents) ||
      claim.quoteTotalCents < claim.amountCents ||
      !Number.isSafeInteger(claim.pricingConfigVersion) ||
      claim.pricingConfigVersion < 101)
      return { status: "unavailable" } as const;
    if (claim.status === "create" &&
      claim.key !== `gate2-unfilled-refund:${claim.quoteId}`)
      return { status: "unavailable" } as const;
    const intent: RefundIntent = { reservationId: input.reservationId,
      studyId: claim.studyId, quoteId: claim.quoteId, checkoutId: claim.checkoutId,
      amountCents: claim.amountCents, quoteTotalCents: claim.quoteTotalCents,
      pricingConfigVersion: claim.pricingConfigVersion,
      key: `gate2-unfilled-refund:${claim.quoteId}` };
    const observation = claim.status === "create"
      ? await input.provider.create(intent)
      : await input.provider.get(claim.refundId, intent);
    if (!/^re_[A-Za-z0-9_]+$/.test(observation.refundId) ||
      observation.amountCents !== intent.amountCents ||
      !["pending", "succeeded", "failed"].includes(observation.kind) ||
      !Number.isFinite(Date.parse(observation.observedAt)))
      return { status: "unavailable" } as const;
    if (!await input.database.record(input.reservationId, observation))
      return { status: "unavailable" } as const;
    return { status: observation.kind, refundId: observation.refundId,
      amountCents: observation.amountCents } as const;
  } catch { return { status: "unavailable" } as const; }
}
