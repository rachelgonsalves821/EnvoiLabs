import { describe, expect, it } from "vitest";
import { canLaunchPaidStudy, canReservePayout } from "../src/index.js";

describe("payment confirmation", () => {
  const paid = { quoteAmountCents: 500, quoteCurrency: "usd" as const,
    checkoutAmountCents: 500, checkoutCurrency: "USD", checkoutPaid: true,
    checkoutStudyId: "study-1", expectedStudyId: "study-1" };

  it("requires matching provider state, study, currency, and cents", () => {
    expect(canLaunchPaidStudy(paid)).toBe(true);
    expect(canLaunchPaidStudy({ ...paid, checkoutPaid: false })).toBe(false);
    expect(canLaunchPaidStudy({ ...paid, checkoutAmountCents: 400 })).toBe(false);
    expect(canLaunchPaidStudy({ ...paid, checkoutCurrency: "cad" })).toBe(false);
    expect(canLaunchPaidStudy({ ...paid, checkoutStudyId: "study-2" })).toBe(false);
    expect(() => canLaunchPaidStudy({ ...paid, checkoutAmountCents: 1.5 })).toThrow(/integer cents/);
  });
});

describe("payout capacity", () => {
  const capacity = { annualCapCents: 200_000, deliveredYtdCents: 199_000,
    pendingYtdCents: 0, proposedCents: 2_000 };

  it("counts pending reservations and keeps payouts below the configured annual cap", () => {
    expect(canReservePayout(capacity)).toBe(false);
    expect(canReservePayout({ ...capacity, proposedCents: 999 })).toBe(true);
    expect(canReservePayout({ ...capacity, deliveredYtdCents: 198_000, pendingYtdCents: 1_000 })).toBe(false);
    expect(() => canReservePayout({ ...capacity, pendingYtdCents: -1 })).toThrow(/integer cents/);
  });
});
