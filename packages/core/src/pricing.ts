import type { PricingConfig } from "@envoi-labs/contracts";

export interface PricedStudy {
  coreQuestions: readonly string[];
  targetCompletes: number;
}

export interface StudyPrice {
  pricingConfigVersion: number;
  totalCents: number;
  incentiveCentsPerComplete: number;
  expectedMarginCents: number;
  lineItems: readonly [{
    label: "Core questions";
    coreQuestionCount: number;
    respondentCount: number;
    unitPriceCents: number;
    amountCents: number;
  }];
}

function positiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive safe integer.`);
}

function nonnegativeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a nonnegative safe integer.`);
}

function multiplyCents(...values: number[]): number {
  const result = values.reduce((product, value) => product * value, 1);
  if (!Number.isSafeInteger(result)) throw new Error("Price exceeds safe integer cents.");
  return result;
}

/** Prices only approved core questions. Probes and screeners are outside this input. */
export function priceStudy(study: PricedStudy, config: Pick<PricingConfig, "version" | "params">): StudyPrice {
  positiveInteger(config.version, "Pricing config version");
  positiveInteger(study.coreQuestions.length, "Core question count");
  if (study.coreQuestions.length < 4 || study.coreQuestions.length > 10 ||
    study.coreQuestions.some((question) => !question.trim())) {
    throw new Error("A guide needs 4 to 10 nonblank core questions.");
  }
  positiveInteger(study.targetCompletes, "Target completes");
  positiveInteger(config.params.unitPriceCents, "Unit price cents");
  nonnegativeInteger(config.params.incentivePerQuestionCents, "Incentive cents");

  const coreQuestionCount = study.coreQuestions.length;
  const totalCents = multiplyCents(coreQuestionCount, study.targetCompletes, config.params.unitPriceCents);
  const incentiveCentsPerComplete = multiplyCents(coreQuestionCount, config.params.incentivePerQuestionCents);
  const totalIncentivesCents = multiplyCents(study.targetCompletes, incentiveCentsPerComplete);
  return {
    pricingConfigVersion: config.version,
    totalCents,
    incentiveCentsPerComplete,
    expectedMarginCents: totalCents - totalIncentivesCents,
    lineItems: [{ label: "Core questions", coreQuestionCount, respondentCount: study.targetCompletes,
      unitPriceCents: config.params.unitPriceCents, amountCents: totalCents }],
  };
}
