import { MarketplaceFeasibilitySchema, QuoteV4Schema,
  type QuoteV4 } from "@envoi-labs/contracts";
import { priceMarketplaceStudy } from "@envoi-labs/core";

export type CheckoutScope = {
  studyId: string;
  briefVersion: number;
  coreQuestionCount: number;
  targetRespondents: number;
  feasibility: ReturnType<typeof MarketplaceFeasibilitySchema.parse>;
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
    pricingConfigVersion: number; lineItems: ReturnType<typeof priceMarketplaceStudy>["lineItems"];
    totalCents: number; incentiveCentsPerComplete: number;
    feasibility: CheckoutScope["feasibility"];
  }): Promise<string>;
  readQuote(studyId: string, quoteId: string): Promise<unknown>;
  claimCheckoutIntent(studyId: string, quoteId: string): Promise<
    { status: "create"; key: string } | { status: "known"; checkoutId: string } |
    { status: "blocked" } | { status: "unavailable" }>;
  recordCheckoutCreated(session: CheckoutSession, eventId: string, observedAt: string): Promise<void>;
};
export type CheckoutProvider = {
  create(key: string, quote: QuoteV4): Promise<CheckoutSession>;
  get(checkoutId: string): Promise<CheckoutSession>;
};

const approvedCheckoutUrl = (value: string) => {
  try {
    const parsed = new URL(value);
    return parsed.origin === "https://checkout.stripe.com" &&
      parsed.username === "" && parsed.password === "";
  } catch { return false; }
};

const matchesQuote = (session: CheckoutSession, quote: QuoteV4) =>
  session.studyId === quote.studyId && session.quoteId === quote.id &&
  session.pricingConfigVersion === quote.pricingConfigVersion &&
  session.amountCents === quote.totalCents && session.currency === quote.currency &&
  session.status === "open" &&
  session.id.trim() !== "" && approvedCheckoutUrl(session.url);

export async function prepareStudyCheckout(
  db: CheckoutDatabase, provider: CheckoutProvider, studyId: string,
): Promise<{ status: "ready"; quote: QuoteV4; checkout: CheckoutSession } |
  { status: "blocked" | "unavailable" }> {
  try {
    const scope = await db.readApprovedScope(studyId);
    const config = await db.readSelectedPricing(studyId);
    if (!scope || !config || scope.studyId !== studyId) return { status: "blocked" };
    const evidence = MarketplaceFeasibilitySchema.safeParse(scope.feasibility);
    if (!evidence.success || evidence.data.studyId !== studyId ||
      evidence.data.eligibleProfileCount < scope.targetRespondents ||
      (evidence.data.projectedCompletes !== null &&
        evidence.data.projectedCompletes < scope.targetRespondents)) return { status: "blocked" };
    const price = priceMarketplaceStudy({ coreQuestionCount: scope.coreQuestionCount,
      respondentCount: scope.targetRespondents, unitPriceCents: config.unitPriceCents,
      rewardPerQuestionCents: config.incentivePerQuestionCents });
    const quoteId = await db.freezeQuote({ studyId, briefVersion: scope.briefVersion,
      pricingConfigId: config.id, pricingConfigVersion: config.version,
      ...price, feasibility: evidence.data });
    const parsed = QuoteV4Schema.safeParse(await db.readQuote(studyId, quoteId));
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
    const intent = await db.claimCheckoutIntent(studyId, quote.id);
    if (intent.status === "blocked") return { status: "blocked" };
    if (intent.status === "unavailable") return { status: "unavailable" };
    let checkout: CheckoutSession;
    if (intent.status === "known") checkout = await provider.get(intent.checkoutId);
    else checkout = await provider.create(intent.key, quote);
    if (!matchesQuote(checkout, quote) ||
      (intent.status === "known" && checkout.id !== intent.checkoutId)) {
      return { status: "blocked" };
    }
    if (intent.status === "create") await db.recordCheckoutCreated(checkout,
      `checkout-created:${checkout.id}`, new Date().toISOString());
    return { status: "ready", quote, checkout };
  } catch (error) {
    if (error instanceof RangeError) return { status: "blocked" };
    return { status: "unavailable" };
  }
}
