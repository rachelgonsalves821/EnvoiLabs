import { QuoteV2Schema, type QuoteV2 } from "@envoi-labs/contracts";

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
};

export type PaidStudyDatabase = {
  readQuote(studyId: string, quoteId: string): Promise<unknown>;
  readCheckoutId(quoteId: string): Promise<string | null>;
  recordObservation(observation: CheckoutObservation): Promise<void>;
  // The database implementation must recheck the current quote and event under
  // one study lock before changing the study state.
  launchPaidStudy(studyId: string, quoteId: string, providerEventId: string): Promise<boolean>;
};

export type PaidCheckoutProvider = { getCheckout(checkoutId: string): Promise<CheckoutObservation> };

const matchesQuoteIdentity = (quote: QuoteV2, checkout: CheckoutObservation, checkoutId: string) =>
  checkout.id === checkoutId && checkout.studyId === quote.studyId &&
  checkout.quoteId === quote.id && checkout.pricingConfigVersion === quote.pricingConfigVersion &&
  checkout.amountCents === quote.totalCents && checkout.currency === quote.currency &&
  Number.isSafeInteger(checkout.refundedCents) && checkout.refundedCents >= 0 &&
  checkout.refundedCents <= quote.totalCents &&
  checkout.eventId.trim() !== "" && Number.isFinite(Date.parse(checkout.observedAt));

export async function reconcilePaidStudyLaunch(
  db: PaidStudyDatabase, provider: PaidCheckoutProvider, studyId: string, quoteId: string,
): Promise<"launched" | "blocked" | "unavailable"> {
  let rawQuote: unknown;
  let checkoutId: string | null;
  try {
    rawQuote = await db.readQuote(studyId, quoteId);
    checkoutId = await db.readCheckoutId(quoteId);
  } catch {
    return "unavailable";
  }
  const quote = QuoteV2Schema.safeParse(rawQuote);
  if (!quote.success || quote.data.studyId !== studyId || quote.data.id !== quoteId) return "blocked";
  if (!checkoutId) return "blocked";

  let checkout: CheckoutObservation;
  try {
    // A webhook or browser redirect is only a hint. Fetch the provider's
    // current checkout state before each launch attempt.
    checkout = await provider.getCheckout(checkoutId);
  } catch {
    return "unavailable";
  }
  if (!matchesQuoteIdentity(quote.data, checkout, checkoutId) ||
    (checkout.status === "refunded" && checkout.refundedCents === 0)) return "blocked";
  if (checkout.status === "pending") return "blocked";

  try {
    await db.recordObservation(checkout);
    if (checkout.status !== "paid" || checkout.refundedCents !== 0) return "blocked";
    return await db.launchPaidStudy(studyId, quoteId, checkout.eventId) ? "launched" : "blocked";
  } catch {
    return "unavailable";
  }
}
