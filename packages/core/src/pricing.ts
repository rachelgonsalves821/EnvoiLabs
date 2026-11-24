export type PriceStudyInput = {
  coreQuestionCount: number;
  respondentCount: number;
  unitPriceCents: number;
  incentivePerQuestionCents: number;
};

export type StudyPrice = {
  totalCents: number;
  incentiveCentsPerComplete: number;
  lineItems: [{
    label: "Core questions";
    coreQuestionCount: number;
    respondentCount: number;
    unitPriceCents: number;
    amountCents: number;
  }];
};

export function priceStudy(input: PriceStudyInput): StudyPrice {
  const { coreQuestionCount, respondentCount, unitPriceCents,
    incentivePerQuestionCents } = input;
  if (![coreQuestionCount, respondentCount, unitPriceCents,
    incentivePerQuestionCents].every(Number.isSafeInteger) ||
    coreQuestionCount < 4 || coreQuestionCount > 10 || respondentCount < 1 ||
    unitPriceCents < 1 || incentivePerQuestionCents < 0) {
    throw new RangeError("Invalid study pricing inputs");
  }
  const totalCents = coreQuestionCount * respondentCount * unitPriceCents;
  const incentiveCentsPerComplete = coreQuestionCount * incentivePerQuestionCents;
  if (!Number.isSafeInteger(totalCents) || !Number.isSafeInteger(incentiveCentsPerComplete) ||
    totalCents > 2_147_483_647 || incentiveCentsPerComplete > 2_147_483_647) {
    throw new RangeError("Study pricing exceeds safe integer cents");
  }
  return { totalCents, incentiveCentsPerComplete, lineItems: [{
    label: "Core questions", coreQuestionCount, respondentCount, unitPriceCents,
    amountCents: totalCents,
  }] };
}
