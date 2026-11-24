import { QuoteV2Schema, type QuoteV2 } from "@envoi-labs/contracts";
import { priceStudy } from "@envoi-labs/core";

export type CheckoutScope = {
  studyId: string;
  briefVersion: number;
  coreQuestionCount: number;
  targetRespondents: number;
  feasibility: { expectedCompletes: number; hours: number };
};
export type CheckoutPricing = {
  id: string;
  version: number;
  unitPriceCents: number;
  incentivePerQuestionCents: number;
};
export type CheckoutSession = {
  id: string;
  studyId: string;
  quoteId: string;
  pricingConfigVersion: number;
  amountCents: number;
  currency: "usd";
  status: "open" | "expired" | "completed";
  url: string;
};
export type CheckoutDatabase = {
  readApprovedScope(studyId: string): Promise<CheckoutScope | null>;
  readSelectedPricing(studyId: string): Promise<CheckoutPricing | null>;
  freezeQuote(input: {
    studyId: string; briefVersion: number; pricingConfigId: string;
    pricingConfigVersion: number; lineItems: ReturnType<typeof priceStudy>["lineItems"];
    totalCents: number; incentiveCentsPerComplete: number;
    feasibility: CheckoutScope["feasibility"];
  }): Promise<string>;
  readQuote(studyId: string, quoteId: string): Promise<unknown>;
  readCheckoutId(quoteId: string): Promise<string | null>;
  recordCheckoutCreated(session: CheckoutSession, eventId: string, observedAt: string): Promise<void>;
};
type CheckoutProvider = {
  findByKey(key: string): Promise<CheckoutSession | null>;
  create(key: string, quote: QuoteV2): Promise<CheckoutSession>;
  get(checkoutId: string): Promise<CheckoutSession>;
};

const matchesQuote = (session: CheckoutSession, quote: QuoteV2) =>
  session.studyId === quote.studyId && session.quoteId === quote.id &&
  session.pricingConfigVersion === quote.pricingConfigVersion &&
  session.amountCents === quote.totalCents && session.currency === quote.currency &&
  session.status === "open" &&
  session.id.trim() !== "" && session.url.trim() !== "";

export async function prepareStudyCheckout(
  db: CheckoutDatabase, provider: CheckoutProvider, studyId: string,
): Promise<{ status: "ready"; quote: QuoteV2; checkout: CheckoutSession } |
  { status: "blocked" | "unavailable" }> {
  try {
    const scope = await db.readApprovedScope(studyId);
    const config = await db.readSelectedPricing(studyId);
    if (!scope || !config || scope.studyId !== studyId) return { status: "blocked" };
    const price = priceStudy({ coreQuestionCount: scope.coreQuestionCount,
      respondentCount: scope.targetRespondents, unitPriceCents: config.unitPriceCents,
      incentivePerQuestionCents: config.incentivePerQuestionCents });
    const quoteId = await db.freezeQuote({ studyId, briefVersion: scope.briefVersion,
      pricingConfigId: config.id, pricingConfigVersion: config.version,
      ...price, feasibility: scope.feasibility });
    const parsed = QuoteV2Schema.safeParse(await db.readQuote(studyId, quoteId));
    if (!parsed.success || parsed.data.studyId !== studyId || parsed.data.id !== quoteId ||
      parsed.data.briefVersion !== scope.briefVersion ||
      parsed.data.pricingConfigId !== config.id ||
      parsed.data.pricingConfigVersion !== config.version ||
      parsed.data.totalCents !== price.totalCents ||
      parsed.data.incentiveCentsPerComplete !== price.incentiveCentsPerComplete ||
      JSON.stringify(parsed.data.lineItems) !== JSON.stringify(price.lineItems)) {
      return { status: "blocked" };
    }
    const quote = parsed.data;
    const key = `gate2-checkout:${quote.id}`;
    const existingId = await db.readCheckoutId(quote.id);
    // A failed lookup never permits a fresh create; an uncertain prior create
    // must first be reconciled through this stable provider key.
    let checkout = existingId ? await provider.get(existingId) : await provider.findByKey(key);
    if (!checkout) checkout = await provider.create(key, quote);
    if (!matchesQuote(checkout, quote) || (existingId && checkout.id !== existingId)) {
      return { status: "blocked" };
    }
    if (!existingId) await db.recordCheckoutCreated(checkout,
      `checkout-created:${checkout.id}`, new Date().toISOString());
    return { status: "ready", quote, checkout };
  } catch (error) {
    if (error instanceof RangeError) return { status: "blocked" };
    return { status: "unavailable" };
  }
}
