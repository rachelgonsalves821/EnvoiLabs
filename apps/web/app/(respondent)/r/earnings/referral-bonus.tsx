import { formatReward } from "../reward";
import { FictionalPayoutNotice } from "./fictional-payout-notice";

export function ReferralBonus({ bonus, payoutStatus = "vested", payoutId = null,
  deliveredAt = null, fictionalPayout = false }: { bonus: number;
    payoutStatus?: "not_vested" | "vested" | "pending" | "ordered" | "delivered" | "failed";
    payoutId?: string | null; deliveredAt?: string | null;
    fictionalPayout?: boolean }) {
  if (bonus <= 0) return <p>A {formatReward(500)} bonus vests after five verified profiles.</p>;
  const label = payoutStatus === "pending" ? "payout pending" :
    payoutStatus === "ordered" ? "payout ordered" :
    payoutStatus === "delivered" ? "delivered" :
    payoutStatus === "failed" ? "payout needs review" : "vested";
  return <p>{formatReward(bonus)} referral bonus {label}
    {fictionalPayout && (payoutStatus === "pending" || payoutStatus === "ordered" ||
      payoutStatus === "delivered" || payoutStatus === "failed") &&
      <FictionalPayoutNotice status={payoutStatus} testId="gate5-mocked-referral-inline" />}
    {payoutStatus === "delivered" && payoutId && deliveredAt &&
      <small> · Delivered {new Date(deliveredAt).toISOString().slice(0, 10)} · Receipt {payoutId}</small>}
  </p>;
}
