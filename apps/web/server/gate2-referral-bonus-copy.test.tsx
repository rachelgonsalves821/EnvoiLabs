import { existsSync, writeFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReferralBonus } from "../app/(respondent)/r/earnings/referral-bonus";
import { FictionalPayoutNotice } from "../app/(respondent)/r/earnings/fictional-payout-notice";

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
  it("keeps a fictional payout label next to a delivered referral receipt", () => {
    const markup = renderToStaticMarkup(<ReferralBonus bonus={500}
      payoutStatus="delivered" payoutId="22222222-2222-4222-8222-222222222222"
      deliveredAt="2026-11-26T07:00:00Z" fictionalPayout />);
    expect(markup).toContain('data-testid="gate5-mocked-referral-inline"');
    expect(markup).toContain("Payout mocked. No Visa sent.");
    expect(markup).toContain("Receipt 22222222-2222-4222-8222-222222222222");
    if (process.env.ENVOI_GATE5_REFERRAL_LABEL_FIXTURE === "1") {
      if (!existsSync("apps/web/.next/BUILD_ID")) throw new Error("Build the exact app source first.");
      writeFileSync("apps/web/.next/gate5-referral-label.html",
        `<!doctype html><html lang="en"><head><title>Fictional Earnings</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>body{margin:16px;font:16px sans-serif}p{overflow-wrap:anywhere}</style>
        </head><body><main><h1>Earnings</h1>${markup}</main></body></html>`);
    }
  });
  it("labels each fictional payout state beside both reward and referral amounts", () => {
    const states = ["pending", "ordered", "delivered", "failed"] as const;
    const phrases = ["Pending payout simulated", "Payout order mocked",
      "Payout mocked. No Visa sent", "Payout failure simulated"];
    for (const [index, status] of states.entries()) {
      const referral = renderToStaticMarkup(<ReferralBonus bonus={500}
        payoutStatus={status} fictionalPayout />);
      const reward = renderToStaticMarkup(<FictionalPayoutNotice status={status}
        testId="gate5-mocked-payout-inline" />);
      expect(referral).toContain(phrases[index]);
      expect(reward).toContain(phrases[index]);
      expect(referral).not.toContain("Receipt");
      expect(reward).toContain("Fictional product test");
      expect(renderToStaticMarkup(<ReferralBonus bonus={500}
        payoutStatus={status} />)).not.toContain("Fictional product test");
    }
    if (process.env.ENVOI_GATE5_REFERRAL_LABEL_FIXTURE === "1") {
      if (!existsSync("apps/web/.next/BUILD_ID")) throw new Error("Build the exact app source first.");
      const rows = states.map((status) => `<section data-state="${status}">
        <h2>Study reward ${status}</h2>${renderToStaticMarkup(<FictionalPayoutNotice
          status={status} testId="gate5-mocked-payout-inline" />)}
        <h2>Referral ${status}</h2>${renderToStaticMarkup(<ReferralBonus
          bonus={500} payoutStatus={status} fictionalPayout
          payoutId={status === "delivered" ? "22222222-2222-4222-8222-222222222222" : null}
          deliveredAt={status === "delivered" ? "2026-11-26T07:00:00Z" : null} />)}
        </section>`).join("");
      writeFileSync("apps/web/.next/gate5-payout-states.html",
        `<!doctype html><html lang="en"><head><title>Fictional Earnings</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>body{margin:16px;font:16px sans-serif}p,small{overflow-wrap:anywhere}
        section{border:1px solid #ddd;padding:8px;margin:8px 0}</style>
        </head><body><main><h1>Earnings</h1>${rows}</main></body></html>`);
    }
  });
});
