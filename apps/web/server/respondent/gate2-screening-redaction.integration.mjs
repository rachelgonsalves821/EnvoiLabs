import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { publishGate2ScreeningRedaction } from "@envoi-labs/services/screening-redaction-publisher";
import { createLocalGate1Redactor } from "./gate1-local-redactor.mjs";

const answerId = "a9f20000-0000-4000-8000-000000000004";
const studyId = "90600000-0000-4000-8000-000000000001";
const sourceVersion = "a9f20000-0000-4000-8000-000000000008";
const policyDigest = "a".repeat(64);
const qualificationDigest = "b".repeat(64);
const manifestSha256 = "c".repeat(64);
const answerText = "I work at Fiction Hospital. Email fictional@example.test.";
const redactedText = "I work at [redacted]. Email [redacted].";
const rawAnswerDigest = createHash("sha256").update(answerText).digest("hex");
const key = "gate2-redaction:a9f20000-0000-4000-8000-000000000009";
let directory;
let config;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "gate2-screening-redaction-"));
  const script = join(directory, "redactor.mjs");
  await writeFile(script, `
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const request = JSON.parse(Buffer.concat(chunks).toString("utf8"));
if (request.text !== ${JSON.stringify(answerText)}) process.exit(2);
process.stdout.write(JSON.stringify({ protocol: "gate1-redaction-v1",
  policyDigest: "${policyDigest}", qualificationDigest: "${qualificationDigest}",
  redactedText: ${JSON.stringify(redactedText)} }));
`, "utf8");
  config = { executable: process.execPath, script,
    manifest: join(directory, "manifest.json"), manifestSha256,
    report: join(directory, "report.json"), reportSha256: qualificationDigest,
    policyDigest, contextModel: join(directory, "context"),
    casingModel: join(directory, "casing") };
});
afterAll(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

function database(activeQualificationDigest = qualificationDigest) {
  const rpc = vi.fn(async (name, args) => name === "read_gate2_screening_redaction_input"
    ? { data: { answerId, studyId, kind: "text", answerText, rawAnswerDigest,
      policyDigest, qualificationDigest: activeQualificationDigest }, error: null }
    : { data: { sourceVersion, qualified: args.requested_redaction_passed }, error: null });
  return { rpc };
}

describe("Gate 1 local redactor to Gate 2 screening publication", () => {
  it("passes only the locally redacted output to the restricted publisher", async () => {
    const db = database();
    const redactor = createLocalGate1Redactor(config);
    const result = await publishGate2ScreeningRedaction(db, redactor,
      { answerId, policyDigest, qualificationDigest, idempotencyKey: key });
    expect(result).toEqual({ sourceVersion, qualified: true });
    expect(db.rpc.mock.calls[1][1]).toMatchObject({
      requested_raw_digest: rawAnswerDigest,
      requested_redacted_text: redactedText,
      requested_redaction_passed: true,
    });
    expect(JSON.stringify(db.rpc.mock.calls[1][1])).not.toContain("fictional@example.test");
  });

  it("withholds output when the local qualification receipt does not match", async () => {
    const db = database("d".repeat(64));
    const redactor = createLocalGate1Redactor({ ...config,
      reportSha256: "d".repeat(64) });
    const result = await publishGate2ScreeningRedaction(db, redactor,
      { answerId, policyDigest, qualificationDigest: "d".repeat(64),
        idempotencyKey: key });
    expect(result).toEqual({ sourceVersion, qualified: false });
    expect(db.rpc.mock.calls[1][1]).toMatchObject({
      requested_redacted_text: null, requested_redaction_passed: false,
    });
  });
});
