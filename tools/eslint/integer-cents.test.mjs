import assert from "node:assert/strict";
import test from "node:test";
import { ESLint } from "eslint";

const eslint = new ESLint({ cache: false });
const ruleId = "envoi/integer-cents";
const filePath = "packages/core/src/pricing.ts";

async function violations(code) {
  const [result] = await eslint.lintText(code, { filePath });
  assert.equal(result.fatalErrorCount, 0);
  return result.messages.filter((message) => message.ruleId === ruleId);
}

test("rejects fractional, unsafe and nonfinite constants in money fields", async () => {
  for (const code of [
    "const unitPriceCents = .4;",
    "const config = { incentive_per_question_cents: (0.4 as number) };",
    "const quote = { ['totalCents']: ready ? 100 : -1.5 };",
    "quote['amount_cents'] = 10 / 4;",
    "invoice.balanceCents += -0.25;",
    "class Receipt { amountCents = 2.5; }",
    "function charge(cents = 2e-1) {}",
    "const PAYOUT_CENTS = 2 ** 53;",
    "const feeCents = 0 / 0;",
  ]) {
    const messages = await violations(code);
    assert.equal(messages.length, 1, code);
    assert.equal(messages[0].severity, 2, code);
  }
});

test("allows whole cents, validated runtime values and unrelated measurements", async () => {
  const messages = await violations(`
    const config = { coreQuestionCents: 100, incentive_cents: 40, feeRate: 0.015 };
    const rewardCents = 5 * 40;
    const refundCents = -500;
    quote.cents = parseCents(input);
    const percents = 0.5;
    totals[rewardCents] = 1.5;
  `);
  assert.deepEqual(messages, []);
});
