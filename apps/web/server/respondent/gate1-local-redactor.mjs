import { spawn } from "node:child_process";
import { isAbsolute, delimiter } from "node:path";

const maxInputBytes = 256 * 1024;
const maxOutputBytes = 512 * 1024;
const sha256 = /^[a-f0-9]{64}$/;
const protocol = "gate1-redaction-v1";

function absolutePath(path) {
  return typeof path === "string" && isAbsolute(path) && !path.includes("\0");
}

function parseResult(chunks, policyDigest, reportSha256) {
  const result = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  if (!result || Object.keys(result).length !== 4 || result.protocol !== protocol ||
      result.policyDigest !== policyDigest || result.qualificationDigest !== reportSha256 ||
      typeof result.redactedText !== "string" || result.redactedText.trim() === "") {
    throw new Error("Invalid local redaction result.");
  }
  return result.redactedText;
}

export function createLocalGate1Redactor(config) {
  const {
    executable, script, manifest, manifestSha256, report, reportSha256,
    policyDigest, contextModel, casingModel, pythonPath, timeoutMs = 60_000,
  } = config ?? {};
  if (![executable, script, manifest, report, contextModel, casingModel].every(absolutePath) ||
      ![manifestSha256, reportSha256, policyDigest].every((digest) => typeof digest === "string" && sha256.test(digest)) ||
      (pythonPath !== undefined && (typeof pythonPath !== "string" || !pythonPath.split(delimiter).every(absolutePath))) ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647) {
    throw new Error("Configure a valid local Gate 1 redactor.");
  }

  const args = [
    script, "--manifest", manifest, "--manifest-sha256", manifestSha256,
    "--report", report, "--report-sha256", reportSha256,
    "--context-model", contextModel, "--casing-model", casingModel,
  ];
  const env = { PYTHONHASHSEED: "0", PYTHONDONTWRITEBYTECODE: "1",
    ...(pythonPath === undefined ? {} : { PYTHONPATH: pythonPath }) };

  async function redact(text) {
    if (typeof text !== "string" || text.length > maxInputBytes || text.trim() === "") {
      throw new Error("Invalid local redaction input.");
    }
    const input = Buffer.from(JSON.stringify({ text }), "utf8");
    if (input.length > maxInputBytes) throw new Error("Invalid local redaction input.");

    return new Promise((resolve, reject) => {
      let child;
      try {
        child = spawn(executable, args, { shell: false, windowsHide: true, stdio: ["pipe", "pipe", "ignore"], env });
      } catch {
        reject(new Error("Local Gate 1 redaction failed."));
        return;
      }

      let settled = false;
      let size = 0;
      const chunks = [];
      const timer = setTimeout(abort, timeoutMs);

      function finish(error, value) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(new Error("Local Gate 1 redaction failed."));
        else resolve(value);
      }

      function abort() {
        if (settled) return;
        finish(true);
        child.kill("SIGKILL");
      }

      child.on("error", abort);
      child.stdin.on("error", abort);
      child.stdout.on("error", abort);
      child.stdout.on("data", (chunk) => {
        if (settled) return;
        size += chunk.length;
        if (size > maxOutputBytes) abort();
        else chunks.push(chunk);
      });
      child.once("close", (code) => {
        if (settled) return;
        try {
          if (code !== 0) finish(true);
          else finish(false, parseResult(chunks, policyDigest, reportSha256));
        } catch {
          finish(true);
        }
      });
      child.stdin.end(input);
    });
  }

  return { policyDigest, qualificationDigest: reportSha256, redact };
}
