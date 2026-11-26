import { describe, expect, it, vi } from "vitest";
import { QuoteV2Schema, QuoteV4Schema } from "@envoi-labs/contracts";
import { reconcileCheckoutObservation, reconcilePaidStudyLaunch } from "../src/paid-study.js";

const quote = QuoteV2Schema.parse((QuoteV2Schema.meta()?.examples as unknown[])[0]);
const currentQuote = QuoteV4Schema.parse((QuoteV4Schema.meta()?.examples as unknown[])[0]);
const paid = { id: "cs_test_1", eventId: "evt_paid_1", studyId: quote.studyId,
  quoteId: quote.id, pricingConfigVersion: quote.pricingConfigVersion,
  amountCents: quote.totalCents, currency: quote.currency, status: "paid" as const,
  refundedCents: 0, observedAt: "2026-11-23T20:00:00.000Z" };

function setup() {
  const db = {
    readQuote: vi.fn().mockResolvedValue(quote),
    readCheckoutId: vi.fn().mockResolvedValue(paid.id),
    recordObservation: vi.fn().mockResolvedValue(undefined),
    launchPaidStudy: vi.fn().mockResolvedValue(true),
    expirePaidStudy: vi.fn().mockResolvedValue(false),
  };
  const provider = { getCheckout: vi.fn().mockResolvedValue(paid) };
  return { db, provider };
}

describe("paid study launch reconciliation", () => {
  it("records a current V4 payment observation without launching or treating a redirect as proof", async () => {
    const { db, provider } = setup();
    db.readQuote.mockResolvedValue(currentQuote);
    provider.getCheckout.mockResolvedValue({ ...paid,
      pricingConfigVersion: currentQuote.pricingConfigVersion,
      amountCents: currentQuote.totalCents });
    expect(await reconcileCheckoutObservation(db, provider,
      currentQuote.studyId, currentQuote.id)).toBe("paid");
    expect(db.recordObservation).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      quoteId: currentQuote.id, amountCents: currentQuote.totalCents }));
    expect(db.launchPaidStudy).not.toHaveBeenCalled();
    provider.getCheckout.mockResolvedValue({ ...paid,
      pricingConfigVersion: currentQuote.pricingConfigVersion,
      amountCents: currentQuote.totalCents, status: "pending" });
    expect(await reconcileCheckoutObservation(db, provider,
      currentQuote.studyId, currentQuote.id)).toBe("pending");
    expect(db.recordObservation).toHaveBeenCalledTimes(1);
  });

  it("keeps historical paid quote reconciliation but rejects old marketplace shapes for launch", async () => {
    const { db, provider } = setup();
    const oldMarketplace = { ...quote, pricingConfigVersion: 101 };
    db.readQuote.mockResolvedValue(oldMarketplace);
    provider.getCheckout.mockResolvedValue({ ...paid, pricingConfigVersion: 101 });
    expect(await reconcileCheckoutObservation(db, provider,
      quote.studyId, quote.id)).toBe("paid");
    expect(await reconcilePaidStudyLaunch(db, provider,
      quote.studyId, quote.id)).toBe("blocked");
    expect(db.launchPaidStudy).not.toHaveBeenCalled();
  });
  it("fetches provider state and binds it to the frozen quote before launch", async () => {
    const { db, provider } = setup();
    expect(await reconcilePaidStudyLaunch(db, provider, quote.studyId, quote.id)).toBe("launched");
    expect(provider.getCheckout).toHaveBeenCalledWith(paid.id);
    expect(db.recordObservation).toHaveBeenCalledWith(paid);
    expect(db.launchPaidStudy).toHaveBeenCalledWith(quote.studyId, quote.id, paid.eventId);
  });

  it("reserves a full unfielded refund after paid launch misses the deadline", async () => {
    const { db, provider } = setup();
    db.readQuote.mockResolvedValue(currentQuote);
    provider.getCheckout.mockResolvedValue({ ...paid,
      pricingConfigVersion: currentQuote.pricingConfigVersion,
      amountCents: currentQuote.totalCents });
    db.launchPaidStudy.mockResolvedValue(false);
    db.expirePaidStudy.mockResolvedValue(true);
    expect(await reconcilePaidStudyLaunch(db, provider,
      currentQuote.studyId, currentQuote.id)).toBe("refund_reserved");
    expect(db.recordObservation).toHaveBeenCalledOnce();
    expect(db.expirePaidStudy).toHaveBeenCalledWith(
      currentQuote.studyId, currentQuote.id, paid.eventId);
    db.expirePaidStudy.mockRejectedValue(new Error("reservation unavailable"));
    expect(await reconcilePaidStudyLaunch(db, provider,
      currentQuote.studyId, currentQuote.id)).toBe("unavailable");
  });

  it.each([
    { quoteId: "11111111-1111-4111-8111-111111111112" },
    { studyId: "11111111-1111-4111-8111-111111111112" },
    { pricingConfigVersion: quote.pricingConfigVersion + 1 },
    { amountCents: quote.totalCents + 1 },
    { currency: "cad" },
    { id: "cs_other" },
    { status: "pending" as const },
    { eventId: "" },
  ])("blocks provider mismatch or nonpayment: %j", async (change) => {
    const { db, provider } = setup();
    provider.getCheckout.mockResolvedValue({ ...paid, ...change });
    expect(await reconcilePaidStudyLaunch(db, provider, quote.studyId, quote.id)).toBe("blocked");
    expect(db.recordObservation).not.toHaveBeenCalled();
    expect(db.launchPaidStudy).not.toHaveBeenCalled();
  });

  it.each([
    { status: "refunded" as const, refundedCents: 200 },
    { status: "failed" as const, refundedCents: 0 },
    { status: "paid" as const, refundedCents: 100 },
  ])("records a verified refund or failure before refusing launch: %j", async (change) => {
    const { db, provider } = setup();
    const observed = { ...paid, ...change };
    provider.getCheckout.mockResolvedValue(observed);
    expect(await reconcilePaidStudyLaunch(db, provider, quote.studyId, quote.id)).toBe("blocked");
    expect(db.recordObservation).toHaveBeenCalledWith(observed);
    expect(db.launchPaidStudy).not.toHaveBeenCalled();
  });

  it("never treats a caller hint or provider outage as a paid checkout", async () => {
    const { db, provider } = setup();
    provider.getCheckout.mockRejectedValue(new Error("provider timeout"));
    expect(await reconcilePaidStudyLaunch(db, provider, quote.studyId, quote.id)).toBe("unavailable");
    expect(db.launchPaidStudy).not.toHaveBeenCalled();
  });

  it("fails closed when the quote store is unavailable", async () => {
    const { db, provider } = setup();
    db.readQuote.mockRejectedValue(new Error("database unavailable"));
    expect(await reconcilePaidStudyLaunch(db, provider, quote.studyId, quote.id)).toBe("unavailable");
    expect(provider.getCheckout).not.toHaveBeenCalled();
  });

  it("blocks stale quote and a database launch refusal", async () => {
    const { db, provider } = setup();
    db.readQuote.mockResolvedValue({ ...quote, studyId: "11111111-1111-4111-8111-111111111112" });
    expect(await reconcilePaidStudyLaunch(db, provider, quote.studyId, quote.id)).toBe("blocked");
    expect(provider.getCheckout).not.toHaveBeenCalled();
    db.readQuote.mockResolvedValue(quote);
    db.launchPaidStudy.mockResolvedValue(false);
    expect(await reconcilePaidStudyLaunch(db, provider, quote.studyId, quote.id)).toBe("blocked");
  });
});
