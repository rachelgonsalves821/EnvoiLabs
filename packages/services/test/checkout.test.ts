import { describe, expect, it, vi } from "vitest";
import { QuoteV3Schema, QuoteV4Schema } from "@envoi-labs/contracts";
import { prepareStudyCheckout } from "../src/checkout.js";

const quote = QuoteV4Schema.parse({
  ...((QuoteV4Schema.meta()?.examples as unknown[])[0] as Record<string, unknown>),
  feasibility: { ...(((QuoteV4Schema.meta()?.examples as unknown[])[0] as {
    feasibility: Record<string, unknown> }).feasibility), eligibleProfileCount: 12 },
});
const scope = { studyId: quote.studyId, briefVersion: quote.briefVersion,
  coreQuestionCount: 5, targetRespondents: 10, feasibility: quote.feasibility };
const config = { id: quote.pricingConfigId, version: quote.pricingConfigVersion,
  unitPriceCents: 200, incentivePerQuestionCents: 100 };
const checkout = { id: "cs_test_1", studyId: quote.studyId, quoteId: quote.id,
  pricingConfigVersion: quote.pricingConfigVersion, amountCents: quote.totalCents,
  currency: "usd" as const, status: "open" as const,
  url: "https://checkout.stripe.com/c/pay/cs_test_1" };

function setup() {
  const db = {
    readApprovedScope: vi.fn().mockResolvedValue(scope),
    readSelectedPricing: vi.fn().mockResolvedValue(config),
    freezeQuote: vi.fn().mockResolvedValue(quote.id),
    readQuote: vi.fn().mockResolvedValue(quote),
    markFictionalQuote: vi.fn().mockResolvedValue(true),
    claimCheckoutIntent: vi.fn().mockResolvedValue({ status: "create", key: `gate2-checkout:${quote.id}`, fictional: false }),
    recordCheckoutCreated: vi.fn().mockResolvedValue(undefined),
  };
  const provider = {
    simulationProvenance: undefined as "fictional" | undefined,
    create: vi.fn().mockResolvedValue(checkout),
    get: vi.fn().mockResolvedValue(checkout),
  };
  return { db, provider };
}

describe("synthetic quote to checkout", () => {
  it("freezes priced scope and binds checkout to its immutable quote and config version", async () => {
    const { db, provider } = setup();
    expect(await prepareStudyCheckout(db, provider, quote.studyId)).toEqual({
      status: "ready", quote, checkout });
    expect(db.freezeQuote).toHaveBeenCalledWith({ studyId: quote.studyId,
      briefVersion: quote.briefVersion, pricingConfigId: config.id,
      pricingConfigVersion: config.version, feasibility: quote.feasibility,
      totalCents: 10_000, incentiveCentsPerComplete: 500,
      lineItems: quote.lineItems });
    expect(db.claimCheckoutIntent).toHaveBeenCalledWith(quote.studyId, quote.id);
    expect(provider.create).toHaveBeenCalledWith(`gate2-checkout:${quote.id}`, quote);
    expect(provider.create).toHaveBeenCalledTimes(1);
    expect(db.recordCheckoutCreated).toHaveBeenCalledWith(checkout,
      `checkout-created:${checkout.id}`, expect.any(String));
  });

  it("keeps an uncertain prior create unavailable until the durable lease grants a same-key retry", async () => {
    const { db, provider } = setup();
    provider.create.mockRejectedValueOnce(new Error("provider response lost"));
    expect(await prepareStudyCheckout(db, provider, quote.studyId)).toEqual({ status: "unavailable" });
    db.claimCheckoutIntent.mockResolvedValueOnce({ status: "unavailable" });
    expect(await prepareStudyCheckout(db, provider, quote.studyId)).toEqual({ status: "unavailable" });
    expect(await prepareStudyCheckout(db, provider, quote.studyId)).toMatchObject({ status: "ready" });
    expect(provider.create).toHaveBeenCalledTimes(2);
    expect(db.recordCheckoutCreated).toHaveBeenCalledTimes(1);
  });

  it("uses a recorded checkout without creating another and blocks provider mismatch", async () => {
    const { db, provider } = setup();
    db.claimCheckoutIntent.mockResolvedValue({ status: "known", checkoutId: checkout.id, fictional: false });
    expect(await prepareStudyCheckout(db, provider, quote.studyId)).toMatchObject({ status: "ready" });
    expect(provider.create).not.toHaveBeenCalled();
    expect(db.recordCheckoutCreated).not.toHaveBeenCalled();
    provider.get.mockResolvedValue({ ...checkout, amountCents: 400 });
    expect(await prepareStudyCheckout(db, provider, quote.studyId)).toEqual({ status: "blocked" });
    provider.get.mockResolvedValue({ ...checkout, status: "expired" });
    expect(await prepareStudyCheckout(db, provider, quote.studyId)).toEqual({ status: "blocked" });
    provider.get.mockResolvedValue({ ...checkout, url: "https://checkout.stripe.com.evil.test/cs_test_1" });
    expect(await prepareStudyCheckout(db, provider, quote.studyId)).toEqual({ status: "blocked" });
  });

  it("fails closed on stale scope, changed quote economics or intent outage", async () => {
    const { db, provider } = setup();
    db.readApprovedScope.mockResolvedValue({ ...scope, briefVersion: 2 });
    expect(await prepareStudyCheckout(db, provider, quote.studyId)).toEqual({ status: "blocked" });
    expect(provider.create).not.toHaveBeenCalled();
    db.readApprovedScope.mockResolvedValue(scope);
    db.readQuote.mockResolvedValue({ ...quote, totalCents: 400 });
    expect(await prepareStudyCheckout(db, provider, quote.studyId)).toEqual({ status: "blocked" });
    db.readQuote.mockResolvedValue(quote);
    db.claimCheckoutIntent.mockRejectedValue(new Error("intent unavailable"));
    expect(await prepareStudyCheckout(db, provider, quote.studyId)).toEqual({ status: "unavailable" });
    expect(provider.create).not.toHaveBeenCalled();
  });

  it("refuses an invented fill time and an older quote before any provider call", async () => {
    const { db, provider } = setup();
    db.readApprovedScope.mockResolvedValueOnce({ ...scope, feasibility: {
      ...scope.feasibility, fillHours: 24 } });
    expect(await prepareStudyCheckout(db, provider, quote.studyId)).toEqual({ status: "blocked" });
    expect(db.freezeQuote).not.toHaveBeenCalled();
    db.readQuote.mockResolvedValueOnce(QuoteV3Schema.parse(
      (QuoteV3Schema.meta()?.examples as unknown[])[0]));
    expect(await prepareStudyCheckout(db, provider, quote.studyId)).toEqual({ status: "blocked" });
    expect(provider.create).not.toHaveBeenCalled();
  });

  it("does not ask for test checkout when eligible or projected completes cannot fill the slots", async () => {
    const { db, provider } = setup();
    db.readApprovedScope.mockResolvedValueOnce({ ...scope, feasibility: {
      ...scope.feasibility, eligibleProfileCount: 9 } });
    expect(await prepareStudyCheckout(db, provider, quote.studyId)).toEqual({ status: "blocked" });
    db.readApprovedScope.mockResolvedValueOnce({ ...scope, feasibility: {
      ...scope.feasibility, history: { offered: 30, accepted: 20, completed: 10 },
      projectedCompletes: 4, basis: "observed_rates" } });
    expect(await prepareStudyCheckout(db, provider, quote.studyId)).toEqual({ status: "blocked" });
    expect(db.freezeQuote).not.toHaveBeenCalled();
    expect(provider.create).not.toHaveBeenCalled();
  });

  it("never creates after a late or exhausted intent", async () => {
    const { db, provider } = setup();
    db.claimCheckoutIntent.mockResolvedValue({ status: "unavailable" });
    expect(await prepareStudyCheckout(db, provider, quote.studyId)).toEqual({ status: "unavailable" });
    expect(provider.create).not.toHaveBeenCalled();
    expect(db.recordCheckoutCreated).not.toHaveBeenCalled();
  });

  it("marks a fictional quote before any mock provider create and denies an unmarked retry", async () => {
    const { db, provider } = setup();
    const fictional = { ...checkout, simulationProvenance: "fictional" as const };
    provider.simulationProvenance = "fictional" as const;
    provider.create.mockResolvedValue(fictional);
    db.claimCheckoutIntent.mockResolvedValue({ status: "create",
      key: `gate2-checkout:${quote.id}`, fictional: true });
    db.markFictionalQuote.mockResolvedValueOnce(false);
    expect(await prepareStudyCheckout(db, provider, quote.studyId)).toEqual({ status: "unavailable" });
    expect(provider.create).not.toHaveBeenCalled();
    expect(db.claimCheckoutIntent).not.toHaveBeenCalled();
    expect(await prepareStudyCheckout(db, provider, quote.studyId)).toMatchObject({ status: "ready" });
    expect(db.markFictionalQuote.mock.invocationCallOrder[1]).toBeLessThan(
      provider.create.mock.invocationCallOrder[0]!);
    provider.simulationProvenance = undefined;
    db.claimCheckoutIntent.mockResolvedValue({ status: "known",
      checkoutId: checkout.id, fictional: true });
    expect(await prepareStudyCheckout(db, provider, quote.studyId)).toEqual({ status: "blocked" });
    expect(provider.get).not.toHaveBeenCalled();
  });
});
