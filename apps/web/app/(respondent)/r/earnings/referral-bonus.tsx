import { formatReward } from "../reward";

export function ReferralBonus({ bonus, payoutStatus = "vested", payoutId = null,
  deliveredAt = null }: { bonus: number;
    payoutStatus?: "not_vested" | "vested" | "pending" | "ordered" | "delivered" | "failed";
    payoutId?: string | null; deliveredAt?: string | null }) {
  if (bonus <= 0) return <p>A {formatReward(500)} bonus vests after five verified profiles.</p>;
  const label = payoutStatus === "pending" ? "payout pending" :
    payoutStatus === "ordered" ? "payout ordered" :
    payoutStatus === "delivered" ? "delivered" :
    payoutStatus === "failed" ? "payout needs review" : "vested";
  return <p>{formatReward(bonus)} referral bonus {label}
    {payoutStatus === "delivered" && payoutId && deliveredAt &&
      <small> · Delivered {new Date(deliveredAt).toISOString().slice(0, 10)} · Receipt {payoutId}</small>}
  </p>;
}
