import { priceStudy, type StudyPrice } from "./pricing.js";

export const MARKETPLACE_UNIT_PRICE_CENTS = 200;
export const MARKETPLACE_REWARD_PER_QUESTION_CENTS = 100;
export const MARKETPLACE_MIN_RESPONDENTS = 10;
export const REFERRAL_BONUS_CENTS = 500;

/** Quote inputs must be selected from the versioned active config before this call. */
export function priceMarketplaceStudy(input: {
  coreQuestionCount: number; respondentCount: number;
  unitPriceCents: number; rewardPerQuestionCents: number;
}): StudyPrice {
  if (input.respondentCount < MARKETPLACE_MIN_RESPONDENTS
    || input.unitPriceCents !== MARKETPLACE_UNIT_PRICE_CENTS
    || input.rewardPerQuestionCents !== MARKETPLACE_REWARD_PER_QUESTION_CENTS) {
    throw new RangeError("Marketplace pricing does not match the approved configuration");
  }
  return priceStudy({ coreQuestionCount: input.coreQuestionCount,
    respondentCount: input.respondentCount, unitPriceCents: input.unitPriceCents,
    incentivePerQuestionCents: input.rewardPerQuestionCents });
}

export interface FrozenSlotQuote {
  readonly coreQuestionCount: number;
  readonly respondentCount: number;
  readonly unitPriceCents: number;
  readonly totalCents: number;
  readonly pricingConfigVersion: number;
}

/** Amount due is derived only from the immutable paid quote, never current prices. */
export function unfilledSlotRefund(quote: FrozenSlotQuote, completedSlots: number,
  alreadyRefundedSlots: number): { missingSlots: number; newRefundSlots: number;
    refundCents: number; pricingConfigVersion: number } {
  const fields = [quote.coreQuestionCount, quote.respondentCount,
    quote.unitPriceCents, quote.totalCents, quote.pricingConfigVersion,
    completedSlots, alreadyRefundedSlots];
  if (!fields.every(Number.isSafeInteger) || quote.coreQuestionCount < 4
    || quote.coreQuestionCount > 10 || quote.respondentCount < MARKETPLACE_MIN_RESPONDENTS
    || quote.unitPriceCents < 1 || quote.pricingConfigVersion < 1
    || quote.totalCents !== quote.coreQuestionCount * quote.respondentCount * quote.unitPriceCents
    || completedSlots < 0 || completedSlots > quote.respondentCount
    || alreadyRefundedSlots < 0 || alreadyRefundedSlots > quote.respondentCount - completedSlots) {
    throw new RangeError("Invalid frozen quote or completion snapshot");
  }
  const missingSlots = quote.respondentCount - completedSlots;
  const newRefundSlots = missingSlots - alreadyRefundedSlots;
  return { missingSlots, newRefundSlots,
    refundCents: newRefundSlots * quote.coreQuestionCount * quote.unitPriceCents,
    pricingConfigVersion: quote.pricingConfigVersion };
}

export interface ReferredProfile {
  readonly respondentId: string;
  readonly referrerId: string;
  readonly verifiedProfile: boolean;
}

/** Quality eligibility is supplied by the approved session decision. */
export function respondentAnsweredQuestionReward(coreQuestionIds: readonly string[],
  approvedAnswerQuestionIds: readonly string[]): number {
  const core = new Set(coreQuestionIds);
  if (core.size !== coreQuestionIds.length || core.size < 4 || core.size > 10
    || core.has("")) throw new RangeError("Invalid core guide");
  const answered = new Set(approvedAnswerQuestionIds.filter((id) => core.has(id)));
  return answered.size * MARKETPLACE_REWARD_PER_QUESTION_CENTS;
}

/** The ledger must reserve the one $5 event under a unique referrer key. */
export function referralVesting(referrerId: string, referrals: readonly ReferredProfile[],
  alreadyVested: boolean): { verifiedFriends: number; bonusCents: number } {
  if (!referrerId) throw new RangeError("Referrer identity required");
  const verified = new Set(referrals.filter((item) =>
    item.referrerId === referrerId && item.respondentId !== referrerId
    && item.respondentId.length > 0 && item.verifiedProfile)
    .map((item) => item.respondentId));
  return { verifiedFriends: verified.size,
    bonusCents: verified.size >= 5 && !alreadyVested ? REFERRAL_BONUS_CENTS : 0 };
}
