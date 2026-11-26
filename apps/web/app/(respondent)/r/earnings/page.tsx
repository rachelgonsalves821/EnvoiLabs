import { Card } from "@envoi-labs/ui";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { requireRespondent } from "../../../../server/auth/identity";
import { sessionClient } from "../../../../server/auth/supabase";
import { readCurrentEarnings } from "../../../../server/respondent/earnings";
import { formatReward } from "../reward";
import { ReferralEntry } from "./referral-entry";

export const metadata: Metadata = { title: "Earnings" };
export const dynamic = "force-dynamic";
const labels = {
  awaiting_reservation: "Reward approved · payout not scheduled",
  pending: "Payout pending",
  ordered: "Payout ordered",
  delivered: "Delivered",
  failed: "Payout needs review",
} as const;

export default async function RespondentEarningsPage() {
  if (process.env.ENVOI_GATE2_EARNINGS_ENABLED !== "true") notFound();
  await requireRespondent();
  const jar = await cookies();
  const client = sessionClient({ getAll: () => jar.getAll() });
  const earnings = client ? await readCurrentEarnings(client) : null;
  return (
    <section className="respondent-earnings" aria-labelledby="respondent-earnings-heading">
      <a href="/r">← Your studies</a>
      <h1 id="respondent-earnings-heading">Earnings</h1>
      {earnings === null ? <p role="alert">Earnings couldn’t load. Refresh this page to try again.</p> : <>
        <p>Rewards from approved answers appear here. A payout is delivered only after it is confirmed.</p>
        <div className="respondent-earnings-summary">
          <Card><h2>Earned</h2><strong>{formatReward(earnings.earnedCents)}</strong></Card>
          <Card><h2>Delivered</h2><strong>{formatReward(earnings.deliveredCents)}</strong></Card>
        </div>
        <h2>Study rewards</h2>
        {earnings.sessions.length === 0 ? <p>No approved study rewards yet.</p> :
          <ul className="respondent-earnings-list">
            {earnings.sessions.map((item) => <li key={item.sessionId}>
              <Card>
                <span>Study reward</span>
                <strong>{formatReward(item.earnedCents)}</strong>
                <span>{labels[item.payoutStatus]}</span>
                {item.payoutStatus === "delivered" && item.payoutId && item.deliveredAt &&
                  <small>Delivered {new Date(item.deliveredAt).toISOString().slice(0, 10)} ·
                    Receipt {item.payoutId}</small>}
              </Card>
            </li>)}
          </ul>}
        <h2>Referrals</h2>
        <Card className="respondent-earnings-referral">
          <p>{earnings.referral.verifiedProfiles} verified profiles</p>
          <p>{earnings.referral.vestedBonusCents > 0
            ? `${formatReward(earnings.referral.vestedBonusCents)} bonus vested · delivery pending`
            : `A ${formatReward(500)} bonus vests after five verified profiles.`}</p>
          {process.env.ENVOI_GATE2_REFERRAL_ENABLED === "true" &&
            <ReferralEntry initialCode={jar.get("gate2-ref")?.value ?? ""} />}
        </Card>
      </>}
    </section>
  );
}
