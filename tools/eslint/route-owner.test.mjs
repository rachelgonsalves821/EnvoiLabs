import assert from "node:assert/strict";
import test from "node:test";
import { ESLint } from "eslint";

const eslint = new ESLint();
for (const [owner, other] of [["researcher", "respondent"], ["respondent", "researcher"]]) {
  test(owner + " routes respect the sibling API boundary", async () => {
    const filePath = "apps/web/app/api/" + owner + "/auth/route.ts";
    for (const [code, expected] of [
      [`import "../../${other}/signup/route";`, 1],
      [`export * from "../../${other}/signup/route";`, 1],
      [`void import("../../${other}/signup/route");`, 1],
      [`import "../session/helper";`, 0],
      [`import "@envoi-labs/contracts";`, 0],
    ]) {
      const [result] = await eslint.lintText(code, { filePath });
      assert.equal(result.fatalErrorCount, 0, code);
      assert.equal(result.messages.filter((m) => m.ruleId === "boundaries/route-owner").length, expected, code);
    }
  });
}
