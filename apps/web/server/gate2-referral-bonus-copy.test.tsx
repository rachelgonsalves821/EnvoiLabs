import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReferralBonus } from "../app/(respondent)/r/earnings/referral-bonus";

describe("referral bonus Earnings copy", () => {
  it("shows vesting without suggesting that a payout was ordered or delivered", () => {
    const markup = renderToStaticMarkup(<ReferralBonus bonus={500} />);
    expect(markup).toContain("$5.00 referral bonus vested");
    expect(markup).not.toMatch(/pending|ordered|delivered/i);
  });
});
