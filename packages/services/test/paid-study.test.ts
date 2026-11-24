import { describe, expect, it, vi } from "vitest";
import { QuoteV2Schema } from "@envoi-labs/contracts";
import { reconcilePaidStudyLaunch } from "../src/paid-study.js";

const quote = QuoteV2Schema.parse((QuoteV2Schema.meta()?.examples as unknown[])[0]);
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
  };
  const provider = { getCheckout: vi.fn().mockResolvedValue(paid) };
  return { db, provider };
}

describe("paid study launch reconciliation", () => {
  it("fetches provider state and binds it to the frozen quote before launch", async () => {
    const { db, provider } = setup();
    expect(await reconcilePaidStudyLaunch(db, provider, quote.studyId, quote.id)).toBe("launched");
    expect(provider.getCheckout).toHaveBeenCalledWith(paid.id);
    expect(db.recordObservation).toHaveBeenCalledWith(paid);
    expect(db.launchPaidStudy).toHaveBeenCalledWith(quote.studyId, quote.id, paid.eventId);
  });

  it.each([
    { quoteId: "11111111-1111-4111-8111-111111111112" },
    { studyId: "11111111-1111-4111-8111-111111111112" },
    { pricingConfigVersion: quote.pricingConfigVersion + 1 },
    { amountCents: quote.totalCents + 1 },
    { currency: "cad" },
    { id: "cs_other" },
    { status: "refunded" as const, refundedCents: 1 },
    { status: "pending" as const },
    { eventId: "" },
  ])("blocks provider mismatch or nonpayment: %j", async (change) => {
    const { db, provider } = setup();
    provider.getCheckout.mockResolvedValue({ ...paid, ...change });
    expect(await reconcilePaidStudyLaunch(db, provider, quote.studyId, quote.id)).toBe("blocked");
    expect(db.recordObservation).not.toHaveBeenCalled();
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
