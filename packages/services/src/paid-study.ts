import { QuoteV2Schema, QuoteV4Schema, type QuoteV2 } from "@envoi-labs/contracts";

export type CheckoutObservation = {
  id: string;
  eventId: string;
  studyId: string;
  quoteId: string;
  pricingConfigVersion: number;
  amountCents: number;
  currency: string;
  status: "pending" | "paid" | "refunded" | "failed";
  refundedCents: number;
  observedAt: string;
  simulationProvenance?: "fictional";
};

export type PaidStudyDatabase = {
  readQuote(studyId: string, quoteId: string): Promise<unknown>;
  readCheckoutId(quoteId: string): Promise<string | null>;
  recordObservation(observation: CheckoutObservation): Promise<void>;
  // The database implementation must recheck the current quote and event under
  // one study lock before changing the study state.
  launchPaidStudy(studyId: string, quoteId: string, providerEventId: string): Promise<boolean>;
  expirePaidStudy?(studyId: string, quoteId: string,
    providerEventId: string): Promise<boolean>;
};

export type PaidCheckoutProvider = { getCheckout(checkoutId: string): Promise<CheckoutObservation> };

const matchesQuoteIdentity = (quote: Pick<QuoteV2, "id" | "studyId" |
  "pricingConfigVersion" | "totalCents" | "currency">,
  checkout: CheckoutObservation, checkoutId: string) =>
  checkout.id === checkoutId && checkout.studyId === quote.studyId &&
  checkout.quoteId === quote.id && checkout.pricingConfigVersion === quote.pricingConfigVersion &&
  checkout.amountCents === quote.totalCents && checkout.currency === quote.currency &&
  Number.isSafeInteger(checkout.refundedCents) && checkout.refundedCents >= 0 &&
  checkout.refundedCents <= quote.totalCents &&
  checkout.eventId.trim() !== "" && Number.isFinite(Date.parse(checkout.observedAt));

/** Financial reconciliation remains available for immutable earlier quotes. */
function parseFrozenQuote(rawQuote: unknown) {
  const current = QuoteV4Schema.safeParse(rawQuote);
  return current.success ? current.data : QuoteV2Schema.safeParse(rawQuote).data;
}

export async function reconcileCheckoutObservation(
  db: PaidStudyDatabase, provider: PaidCheckoutProvider, studyId: string, quoteId: string,
): Promise<"pending" | "paid" | "refunded" | "failed" | "blocked" | "unavailable"> {
  let rawQuote: unknown;
  let checkoutId: string | null;
  try {
    rawQuote = await db.readQuote(studyId, quoteId);
    checkoutId = await db.readCheckoutId(quoteId);
  } catch { return "unavailable"; }
  const quote = parseFrozenQuote(rawQuote);
  if (!quote || quote.studyId !== studyId || quote.id !== quoteId || !checkoutId)
    return "blocked";
  let checkout: CheckoutObservation;
  try { checkout = await provider.getCheckout(checkoutId); }
  catch { return "unavailable"; }
  if (!matchesQuoteIdentity(quote, checkout, checkoutId) ||
    (checkout.status === "refunded" && checkout.refundedCents === 0)) return "blocked";
  if (checkout.status === "pending") return "pending";
  try { await db.recordObservation(checkout); }
  catch { return "unavailable"; }
  return checkout.status;
}

export async function reconcilePaidStudyLaunch(
  db: PaidStudyDatabase, provider: PaidCheckoutProvider, studyId: string, quoteId: string,
): Promise<"launched" | "refund_reserved" | "blocked" | "unavailable"> {
  let rawQuote: unknown;
  let checkoutId: string | null;
  try {
    rawQuote = await db.readQuote(studyId, quoteId);
    checkoutId = await db.readCheckoutId(quoteId);
  } catch {
    return "unavailable";
  }
  const quote = parseFrozenQuote(rawQuote);
  if (!quote || quote.studyId !== studyId || quote.id !== quoteId ||
    (quote.pricingConfigVersion >= 101 && !QuoteV4Schema.safeParse(rawQuote).success)) return "blocked";
  if (!checkoutId) return "blocked";

  let checkout: CheckoutObservation;
  try {
    // A webhook or browser redirect is only a hint. Fetch the provider's
    // current checkout state before each launch attempt.
    checkout = await provider.getCheckout(checkoutId);
  } catch {
    return "unavailable";
  }
  if (!matchesQuoteIdentity(quote, checkout, checkoutId) ||
    (checkout.status === "refunded" && checkout.refundedCents === 0)) return "blocked";
  if (checkout.status === "pending") return "blocked";

  try {
    await db.recordObservation(checkout);
    if (checkout.status !== "paid" || checkout.refundedCents !== 0) return "blocked";
    if (await db.launchPaidStudy(studyId, quoteId, checkout.eventId)) return "launched";
    return db.expirePaidStudy && await db.expirePaidStudy(
      studyId, quoteId, checkout.eventId) ? "refund_reserved" : "blocked";
  } catch {
    return "unavailable";
  }
}
