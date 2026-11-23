import { mkdtemp, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createLocalGate1Redactor } from "./gate1-local-redactor.mjs";

const input = "A fictional address and a useful detail.";
const result = "A [redacted] and a useful detail.";
const digest = "a".repeat(64);
const reportDigest = "b".repeat(64);
const manifestDigest = "c".repeat(64);
const scriptSource = `
import { basename, delimiter, dirname, join } from "node:path";

const [script, manifestFlag, manifest, manifestHashFlag, manifestHash, reportFlag, report,
  reportHashFlag, reportHash, contextFlag, context, casingFlag, casing, ...extra] = process.argv.slice(1);
const root = dirname(script);
if ([manifestFlag, manifestHashFlag, reportFlag, reportHashFlag, contextFlag, casingFlag].join(",") !==
    "--manifest,--manifest-sha256,--report,--report-sha256,--context-model,--casing-model" ||
    dirname(manifest) !== root || manifestHash !== "${manifestDigest}" || reportHash !== "${reportDigest}" ||
    report !== join(root, "aggregate report.json") || context !== join(root, "context model") ||
    casing !== join(root, "casing model") || extra.length !== 0 ||
    process.env.PYTHONHASHSEED !== "0" || process.env.PYTHONDONTWRITEBYTECODE !== "1" ||
    process.env.ENVOI_SYNTHETIC_PARENT_SECRET !== undefined) process.exit(2);
const mode = basename(manifest, ".json");
const expectedPythonPath = [join(root, "first dependency"), join(root, "second dependency")].join(delimiter);
if (mode === "with-python-path" && process.env.PYTHONPATH !== expectedPythonPath) process.exit(2);
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const request = JSON.parse(Buffer.concat(chunks).toString("utf8"));
if (Object.keys(request).length !== 1 || request.text !== ${JSON.stringify(input)}) process.exit(2);
const response = {
  protocol: "gate1-redaction-v1", policyDigest: "${digest}", qualificationDigest: reportHash,
  redactedText: ${JSON.stringify(result)},
};
if (mode === "timeout") {
  await new Promise((resolve) => setTimeout(resolve, 10_000));
} else if (mode === "oversized") {
  process.stdout.write("x".repeat(512 * 1024 + 1));
} else if (mode === "invalid-utf8") {
  process.stdout.write(Buffer.from([0xc0, 0x80]));
} else if (mode === "invalid-json") {
  process.stdout.write("synthetic details outside JSON");
} else {
  if (mode === "wrong-policy") response.policyDigest = "d".repeat(64);
  if (mode === "wrong-report") response.qualificationDigest = "d".repeat(64);
  if (mode === "wrong-protocol") response.protocol = "unrelated-protocol";
  if (mode === "empty-output") response.redactedText = " ";
  if (mode === "extra-field") response.private = "synthetic details outside the protocol";
  process.stdout.write(JSON.stringify(response));
  if (mode === "two-messages") process.stdout.write(JSON.stringify(response));
  if (mode === "nonzero") process.exitCode = 1;
}
`;

let directory;
let config;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "gate1 local redactor "));
  config = {
    executable: process.execPath,
    script: join(directory, "synthetic redactor.mjs"),
    manifest: join(directory, "valid.json"),
    manifestSha256: manifestDigest,
    report: join(directory, "aggregate report.json"),
    reportSha256: reportDigest,
    policyDigest: digest,
    contextModel: join(directory, "context model"),
    casingModel: join(directory, "casing model"),
  };
  await writeFile(config.script, scriptSource, "utf8");
});

afterAll(async () => {
  await unlink(config.script);
  await rmdir(directory);
});

afterEach(() => vi.unstubAllEnvs());

describe("local Gate 1 redactor", () => {
  it("passes only the configured args, allowed environment and stdin payload to one child", async () => {
    vi.stubEnv("ENVOI_SYNTHETIC_PARENT_SECRET", "not-a-real-secret");
    const pythonPath = [join(directory, "first dependency"), join(directory, "second dependency")].join(delimiter);
    const { policyDigest, redact } = createLocalGate1Redactor({
      ...config, manifest: join(directory, "with-python-path.json"), pythonPath,
    });
    expect(policyDigest).toBe(digest);
    await expect(redact(input)).resolves.toBe(result);
    await expect(createLocalGate1Redactor(config).redact(input)).resolves.toBe(result);
  });

  it.each([
    "wrong-policy", "wrong-report", "wrong-protocol", "nonzero", "empty-output", "extra-field", "two-messages",
    "oversized", "invalid-utf8", "invalid-json", "timeout",
  ])("rejects a %s subprocess result without including private fields", async (mode) => {
    const redactor = createLocalGate1Redactor({
      ...config, manifest: join(directory, `${mode}.json`), ...(mode === "timeout" ? { timeoutMs: 250 } : {}),
    });
    await expect(redactor.redact(input)).rejects.toThrow(/^Local Gate 1 redaction failed\.$/);
  });

  it("reports an executable launch failure without including its path", async () => {
    const redactor = createLocalGate1Redactor({ ...config, executable: join(directory, "missing executable") });
    await expect(redactor.redact(input)).rejects.toThrow(/^Local Gate 1 redaction failed\.$/);
  });

  it("rejects relative paths, invalid digests and invalid timeouts", () => {
    for (const invalid of [
      { script: "redactor.py" }, { pythonPath: "./deps" }, { manifestSha256: "A".repeat(64) },
      { policyDigest: "a".repeat(63) }, { reportSha256: "b".repeat(64) + "\n" }, { timeoutMs: 0 },
    ]) {
      expect(() => createLocalGate1Redactor({ ...config, ...invalid })).toThrow(/^Configure a valid local Gate 1 redactor\.$/);
    }
  });

  it("rejects empty or byte-oversized input before spawning the child", async () => {
    const { redact } = createLocalGate1Redactor(config);
    await expect(redact(" \n ")).rejects.toThrow(/^Invalid local redaction input\.$/);
    await expect(redact("😀".repeat(65_536))).rejects.toThrow(/^Invalid local redaction input\.$/);
  });
});
