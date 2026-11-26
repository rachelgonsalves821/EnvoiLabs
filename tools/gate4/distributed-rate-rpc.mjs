import { createHmac, randomUUID } from "node:crypto";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";

const self = fileURLToPath(import.meta.url);

export function localRpcUrl(base) {
  const url = new URL(base);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      url.username || url.password || url.search || url.hash ||
      (url.pathname !== "/" && url.pathname !== "")) {
    throw new Error("Gate 4 RPC harness requires a local disposable Supabase API origin.");
  }
  url.pathname = "/rest/v1/rpc/consume_gate4_rate_limit";
  return url.toString();
}

function positiveInteger(value, name, maximum = 1000) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(`${name} must be a positive integer no greater than ${maximum}.`);
  }
  return parsed;
}

function digest(secret, kind, value) {
  return createHmac("sha256", secret).update(`gate4-rate-v1\0${kind}\0${value}`).digest("hex");
}

export function rulesForRun({ surface, identity, source, secret, windowSeconds, identityMax, sourceMax }) {
  if (!["email-start", "audio-upload"].includes(surface) || !secret ||
      Buffer.byteLength(secret) < 32 || !identity || !source) throw new Error("Invalid synthetic RPC fixture.");
  const identityKind = surface === "email-start" ? "email" : "respondent";
  return [
    { surface, key_kind: identityKind, key_digest: digest(secret, identityKind, identity),
      max_attempts: positiveInteger(identityMax, "identityMax"),
      window_seconds: positiveInteger(windowSeconds, "windowSeconds", 86_400) },
    { surface, key_kind: "source", key_digest: digest(secret, `${surface}:source`, source),
      max_attempts: positiveInteger(sourceMax, "sourceMax"),
      window_seconds: positiveInteger(windowSeconds, "windowSeconds", 86_400) },
  ];
}

export function classifyRpcReply(status, value) {
  if (status !== 200 || !value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Limiter RPC unavailable or policy disabled in the disposable database.");
  }
  if (value.allowed === true) return "allowed";
  if (value.allowed === false && Number.isSafeInteger(value.retry_after_seconds) &&
      value.retry_after_seconds > 0) return "limited";
  throw new Error("Limiter RPC returned an invalid decision.");
}

async function callRpc(url, key, rules) {
  const response = await fetch(url, { method: "POST", headers: {
    apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json",
  }, body: JSON.stringify({ requested_rules: rules }) });
  let value;
  try { value = await response.json(); } catch { value = null; }
  return classifyRpcReply(response.status, value);
}

function processBatch(url, key, rules, count) {
  return new Promise((resolve, reject) => {
    const worker = fork(self, [], { env: { ...process.env, GATE4_RPC_WORKER: "1",
      GATE4_RPC_URL: url, GATE4_RPC_KEY: key }, stdio: ["ignore", "ignore", "ignore", "ipc"] });
    const timeout = setTimeout(() => { worker.kill(); reject(new Error("Limiter RPC worker timed out.")); }, 30_000);
    worker.once("error", (error) => { clearTimeout(timeout); reject(error); });
    worker.once("exit", (code) => {
      if (code !== 0) { clearTimeout(timeout); reject(new Error("Limiter RPC worker exited early.")); }
    });
    worker.once("message", (message) => {
      clearTimeout(timeout);
      worker.disconnect();
      if (message?.error) reject(new Error(message.error));
      else resolve(message.results);
    });
    worker.send({ rules, count });
  });
}

export async function runTwoProcessRpc({ base, key, rules, identityMax, sourceMax }) {
  const url = localRpcUrl(base);
  if (!key || !Array.isArray(rules) || rules.length !== 2) throw new Error("Missing RPC fixture input.");
  const count = Math.min(positiveInteger(identityMax, "identityMax"),
    positiveInteger(sourceMax, "sourceMax")) + 2;
  const [first, second] = await Promise.all([
    processBatch(url, key, rules, count), processBatch(url, key, rules, count),
  ]);
  const results = [...first, ...second];
  const allowed = results.filter((result) => result === "allowed").length;
  const expectedAllowed = Math.min(identityMax, sourceMax);
  if (allowed !== expectedAllowed || results.length !== count * 2 ||
      results.some((result) => !["allowed", "limited"].includes(result))) {
    throw new Error(`Atomic quota mismatch: expected ${expectedAllowed} grants, observed ${allowed}.`);
  }
  return { processCount: 2, attempts: results.length, allowed, limited: results.length - allowed };
}

export async function verifyNoPartialIncrement({ base, key, surface, secret,
  windowSeconds, identityMax, sourceMax }) {
  const url = localRpcUrl(base);
  positiveInteger(identityMax, "identityMax");
  positiveInteger(sourceMax, "sourceMax");
  if (identityMax > sourceMax || sourceMax > 200) {
    throw new Error("Partial-increment fixture requires identityMax <= sourceMax <= 200.");
  }
  const nonce = randomUUID();
  const exhaustedSource = `synthetic-exhausted-${nonce}`;
  const freshSource = `synthetic-fresh-${nonce}`;
  const identity = (suffix) => surface === "email-start"
    ? `gate4-${suffix}@example.test` : randomUUID();
  for (let index = 0; index < sourceMax; index++) {
    const rules = rulesForRun({ surface, identity: identity(`${nonce}-${index}`),
      source: exhaustedSource, secret, windowSeconds, identityMax, sourceMax });
    if (await callRpc(url, key, rules) !== "allowed") {
      throw new Error("Could not fill the disposable source window.");
    }
  }
  const probeIdentity = identity(`${nonce}-probe`);
  const probeRules = rulesForRun({ surface, identity: probeIdentity, source: exhaustedSource,
    secret, windowSeconds, identityMax, sourceMax });
  if (await callRpc(url, key, probeRules) !== "limited") {
    throw new Error("Exhausted source unexpectedly admitted a probe.");
  }
  const freshRules = rulesForRun({ surface, identity: probeIdentity, source: freshSource,
    secret, windowSeconds, identityMax, sourceMax });
  for (let index = 0; index < identityMax; index++) {
    if (await callRpc(url, key, freshRules) !== "allowed") {
      throw new Error("Denied probe consumed an identity counter (partial increment).");
    }
  }
  return { sourceFilled: sourceMax, deniedProbe: 1, freshIdentityGrants: identityMax };
}

if (process.env.GATE4_RPC_WORKER === "1") {
  process.once("message", async ({ rules, count }) => {
    try {
      const results = await Promise.all(Array.from({ length: count }, () =>
        callRpc(process.env.GATE4_RPC_URL, process.env.GATE4_RPC_KEY, rules)));
      process.send({ results });
    } catch (error) {
      process.send({ error: `Disposable limiter RPC batch failed: ${error.message}` });
    }
  });
} else if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    if (process.env.ENVOI_TEST_LOCAL_SUPABASE !== "1") {
      throw new Error("Set ENVOI_TEST_LOCAL_SUPABASE=1 for the disposable stack.");
    }
    const surface = process.env.GATE4_RPC_SURFACE ?? "email-start";
    const identityMax = positiveInteger(process.env.GATE4_RPC_IDENTITY_MAX, "GATE4_RPC_IDENTITY_MAX");
    const sourceMax = positiveInteger(process.env.GATE4_RPC_SOURCE_MAX, "GATE4_RPC_SOURCE_MAX");
    const nonce = randomUUID();
    const identity = surface === "email-start" ? `gate4-${nonce}@example.test` : nonce;
    const rules = rulesForRun({ surface, identity, source: `synthetic-source-${nonce}`,
      secret: process.env.GATE4_RATE_LIMIT_HMAC_KEY,
      windowSeconds: process.env.GATE4_RPC_WINDOW_SECONDS, identityMax, sourceMax });
    const result = await runTwoProcessRpc({ base: process.env.SUPABASE_URL,
      key: process.env.SUPABASE_SERVICE_ROLE_KEY, rules, identityMax, sourceMax });
    const partial = await verifyNoPartialIncrement({ base: process.env.SUPABASE_URL,
      key: process.env.SUPABASE_SERVICE_ROLE_KEY, surface,
      secret: process.env.GATE4_RATE_LIMIT_HMAC_KEY,
      windowSeconds: process.env.GATE4_RPC_WINDOW_SECONDS, identityMax, sourceMax });
    process.stdout.write(`${JSON.stringify({ surface, ...result, partial })}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
