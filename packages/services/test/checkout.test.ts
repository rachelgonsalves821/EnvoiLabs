import { describe, expect, it, vi } from "vitest";
import { QuoteV2Schema } from "@envoi-labs/contracts";
import { prepareStudyCheckout } from "../src/checkout.js";

const quote = QuoteV2Schema.parse((QuoteV2Schema.meta()?.examples as unknown[])[0]);
const scope = { studyId: quote.studyId, briefVersion: quote.briefVersion,
  coreQuestionCount: 5, targetRespondents: 1, feasibility: quote.feasibility };
const config = { id: quote.pricingConfigId, version: quote.pricingConfigVersion,
  unitPriceCents: 100, incentivePerQuestionCents: 40 };
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
    readCheckoutId: vi.fn().mockResolvedValue(null),
    recordCheckoutCreated: vi.fn().mockResolvedValue(undefined),
  };
  const provider = {
    findByKey: vi.fn().mockResolvedValue({ status: "absent" }),
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
      totalCents: 500, incentiveCentsPerComplete: 200,
      lineItems: quote.lineItems });
    expect(provider.findByKey).toHaveBeenCalledWith(`gate2-checkout:${quote.id}`);
    expect(provider.create).toHaveBeenCalledTimes(1);
    expect(db.recordCheckoutCreated).toHaveBeenCalledWith(checkout,
      `checkout-created:${checkout.id}`, expect.any(String));
  });

  it("finds an uncertain prior create by stable provider key on retry", async () => {
    const { db, provider } = setup();
    provider.create.mockRejectedValueOnce(new Error("provider response lost"));
    expect(await prepareStudyCheckout(db, provider, quote.studyId)).toEqual({ status: "unavailable" });
    provider.findByKey.mockResolvedValueOnce({ status: "found", checkout });
    expect(await prepareStudyCheckout(db, provider, quote.studyId)).toMatchObject({ status: "ready" });
    expect(provider.create).toHaveBeenCalledTimes(1);
    expect(db.recordCheckoutCreated).toHaveBeenCalledTimes(1);
  });

  it("uses a recorded checkout without creating another and blocks provider mismatch", async () => {
    const { db, provider } = setup();
    db.readCheckoutId.mockResolvedValue(checkout.id);
    expect(await prepareStudyCheckout(db, provider, quote.studyId)).toMatchObject({ status: "ready" });
    expect(provider.findByKey).not.toHaveBeenCalled();
    expect(provider.create).not.toHaveBeenCalled();
    expect(db.recordCheckoutCreated).not.toHaveBeenCalled();
    provider.get.mockResolvedValue({ ...checkout, amountCents: 400 });
    expect(await prepareStudyCheckout(db, provider, quote.studyId)).toEqual({ status: "blocked" });
    provider.get.mockResolvedValue({ ...checkout, status: "expired" });
    expect(await prepareStudyCheckout(db, provider, quote.studyId)).toEqual({ status: "blocked" });
    provider.get.mockResolvedValue({ ...checkout, url: "https://checkout.stripe.com.evil.test/cs_test_1" });
    expect(await prepareStudyCheckout(db, provider, quote.studyId)).toEqual({ status: "blocked" });
  });

  it("fails closed on stale scope, changed quote economics or provider lookup outage", async () => {
    const { db, provider } = setup();
    db.readApprovedScope.mockResolvedValue({ ...scope, briefVersion: 2 });
    expect(await prepareStudyCheckout(db, provider, quote.studyId)).toEqual({ status: "blocked" });
    expect(provider.create).not.toHaveBeenCalled();
    db.readApprovedScope.mockResolvedValue(scope);
    db.readQuote.mockResolvedValue({ ...quote, totalCents: 400 });
    expect(await prepareStudyCheckout(db, provider, quote.studyId)).toEqual({ status: "blocked" });
    db.readQuote.mockResolvedValue(quote);
    provider.findByKey.mockRejectedValue(new Error("lookup unavailable"));
    expect(await prepareStudyCheckout(db, provider, quote.studyId)).toEqual({ status: "unavailable" });
    expect(provider.create).not.toHaveBeenCalled();
  });

  it("never creates after an incomplete provider reconciliation", async () => {
    const { db, provider } = setup();
    provider.findByKey.mockResolvedValue({ status: "uncertain" });
    expect(await prepareStudyCheckout(db, provider, quote.studyId)).toEqual({ status: "unavailable" });
    expect(provider.create).not.toHaveBeenCalled();
    expect(db.recordCheckoutCreated).not.toHaveBeenCalled();
  });
});
