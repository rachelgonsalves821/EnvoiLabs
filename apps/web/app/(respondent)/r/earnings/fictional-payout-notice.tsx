type PayoutState = "pending" | "ordered" | "delivered" | "failed";

const copy: Record<PayoutState, string> = {
  pending: "Fictional product test · Pending payout simulated. No Visa order placed.",
  ordered: "Fictional product test · Payout order mocked. No Visa order placed.",
  delivered: "Fictional product test · Payout mocked. No Visa sent. This receipt is synthetic.",
  failed: "Fictional product test · Payout failure simulated. No Visa order placed.",
};

export function FictionalPayoutNotice({ status, testId }: {
  status: PayoutState; testId: string;
}) {
  return <small data-testid={testId}> {copy[status]}</small>;
}
