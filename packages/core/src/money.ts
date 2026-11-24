function requireCents(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be nonnegative integer cents.`);
}

export interface PaymentConfirmation {
  quoteAmountCents: number;
  quoteCurrency: "usd";
  checkoutAmountCents: number;
  checkoutCurrency: string;
  checkoutPaid: boolean;
  checkoutStudyId: string;
  expectedStudyId: string;
}

/** A webhook alone is insufficient: use the provider's confirmed checkout state. */
export function canLaunchPaidStudy(input: PaymentConfirmation): boolean {
  requireCents(input.quoteAmountCents, "Quote amount");
  requireCents(input.checkoutAmountCents, "Checkout amount");
  return input.quoteAmountCents > 0 && input.checkoutPaid &&
    input.quoteAmountCents === input.checkoutAmountCents &&
    input.quoteCurrency === input.checkoutCurrency.toLowerCase() &&
    input.checkoutStudyId === input.expectedStudyId && !!input.expectedStudyId;
}

export interface PayoutCapacity {
  annualCapCents: number;
  deliveredYtdCents: number;
  pendingYtdCents: number;
  proposedCents: number;
}

/** Call while holding the respondent's payout reservation lock. */
export function canReservePayout(input: PayoutCapacity): boolean {
  for (const [name, value] of Object.entries(input)) requireCents(value, name);
  if (input.annualCapCents === 0 || input.proposedCents === 0) return false;
  return input.deliveredYtdCents + input.pendingYtdCents + input.proposedCents < input.annualCapCents;
}
