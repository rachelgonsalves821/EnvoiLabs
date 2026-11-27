import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("reviewed report source package resolution", () => {
  it("loads from the web app without a compiled .js sibling", () => {
    const webApp = fileURLToPath(new URL("../../", import.meta.url));
    const output = execFileSync(process.execPath, [
      "--experimental-strip-types", "--input-type=module", "-e",
      "await import('@envoi-labs/services/reviewed-report-adapter'); console.log('resolved')",
    ], { cwd: webApp, encoding: "utf8" });
    expect(output.trim()).toBe("resolved");
  });
});
