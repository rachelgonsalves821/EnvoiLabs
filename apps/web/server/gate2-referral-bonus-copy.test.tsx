import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReferralBonus } from "../app/(respondent)/r/earnings/referral-bonus";

describe("referral bonus Earnings copy", () => {
  it("shows vesting without suggesting that a payout was ordered or delivered", () => {
    const markup = renderToStaticMarkup(<ReferralBonus bonus={500} />);
    expect(markup).toContain("$5.00 referral bonus vested");
    expect(markup).not.toMatch(/pending|ordered|delivered/i);
  });
  it("shows a provider-confirmed referral receipt only after delivery", () => {
    const markup = renderToStaticMarkup(<ReferralBonus bonus={500}
      payoutStatus="delivered" payoutId="22222222-2222-4222-8222-222222222222"
      deliveredAt="2026-11-26T07:00:00Z" />);
    expect(markup).toContain("$5.00 referral bonus delivered");
    expect(markup).toContain("Receipt 22222222-2222-4222-8222-222222222222");
  });
});
