import { formatReward } from "../reward";

export function ReferralBonus({ bonus }: { bonus: number }) {
  return <p>{bonus > 0
    ? `${formatReward(bonus)} referral bonus vested`
    : `A ${formatReward(500)} bonus vests after five verified profiles.`}</p>;
}
