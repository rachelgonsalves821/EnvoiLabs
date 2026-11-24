import { createServer } from "node:http";
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { classifyRpcReply, localRpcUrl, rulesForRun, runTwoProcessRpc,
  verifyNoPartialIncrement } from "./distributed-rate-rpc.mjs";

const fixture = {
  surface: "email-start", identity: "gate4-synthetic@example.test", source: "synthetic-source",
  secret: "synthetic-only-secret-with-at-least-32-bytes", windowSeconds: 900,
  identityMax: 5, sourceMax: 7,
};

test("local-only guard rejects a remote or HTTPS endpoint", () => {
  assert.equal(localRpcUrl("http://127.0.0.1:54321"),
    "http://127.0.0.1:54321/rest/v1/rpc/consume_gate4_rate_limit");
  for (const value of ["https://127.0.0.1:54321", "http://example.test:54321",
    "http://127.0.0.1:54321/custom", "http://192.168.1.1:54321"]) {
    assert.throws(() => localRpcUrl(value), /local disposable/);
  }
});

test("builds the exact two-rule RPC body without plaintext identity or source", () => {
  const rules = rulesForRun(fixture);
  assert.deepEqual(rules.map(({ surface, key_kind, max_attempts, window_seconds }) =>
    [surface, key_kind, max_attempts, window_seconds]), [
    ["email-start", "email", 5, 900], ["email-start", "source", 7, 900],
  ]);
  assert.ok(rules.every(({ key_digest }) => /^[a-f0-9]{64}$/.test(key_digest)));
  assert.doesNotMatch(JSON.stringify(rules), /gate4-synthetic|synthetic-source/);
  assert.notEqual(rules[0].key_digest, rules[1].key_digest);
});

test("rejects malformed, disabled or error replies", () => {
  assert.equal(classifyRpcReply(200, { allowed: true }), "allowed");
  assert.equal(classifyRpcReply(200, { allowed: false, retry_after_seconds: 5 }), "limited");
  for (const [status, value] of [[400, { allowed: true }], [200, null],
    [200, { allowed: false, retry_after_seconds: 0 }], [200, { allowed: "yes" }]]) {
    assert.throws(() => classifyRpcReply(status, value));
  }
});

test("two independent workers detect the exact shared atomic quota", async () => {
  const counts = new Map();
  const server = createServer(async (request, response) => {
    assert.equal(request.url, "/rest/v1/rpc/consume_gate4_rate_limit");
    assert.equal(request.headers.apikey, "synthetic-service-key");
    let body = "";
    for await (const chunk of request) body += chunk;
    const rules = JSON.parse(body).requested_rules;
    assert.equal(rules.length, 2);
    const keys = rules.map((rule) => `${rule.surface}:${rule.key_kind}:${rule.key_digest}`);
    const denied = rules.some((rule, index) => (counts.get(keys[index]) ?? 0) >= rule.max_attempts);
    if (!denied) keys.forEach((key) => counts.set(key, (counts.get(key) ?? 0) + 1));
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(denied
      ? { allowed: false, retry_after_seconds: 100 } : { allowed: true }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const result = await runTwoProcessRpc({ base: `http://127.0.0.1:${server.address().port}`,
      key: "synthetic-service-key", rules: rulesForRun(fixture),
      identityMax: fixture.identityMax, sourceMax: fixture.sourceMax });
    assert.deepEqual(result, { processCount: 2, attempts: 14, allowed: 5, limited: 9 });
    assert.deepEqual([...counts.values()], [5, 5]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("partial-increment probe passes an atomic fixture and detects a split write", async () => {
  for (const partialOnDenial of [false, true]) {
    const counts = new Map();
    const server = createServer(async (request, response) => {
      let body = "";
      for await (const chunk of request) body += chunk;
      const rules = JSON.parse(body).requested_rules;
      const keys = rules.map((rule) => `${rule.surface}:${rule.key_kind}:${rule.key_digest}`);
      const denied = rules.some((rule, index) => (counts.get(keys[index]) ?? 0) >= rule.max_attempts);
      if (!denied) keys.forEach((key) => counts.set(key, (counts.get(key) ?? 0) + 1));
      else if (partialOnDenial) counts.set(keys[0], (counts.get(keys[0]) ?? 0) + 1);
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(denied
        ? { allowed: false, retry_after_seconds: 100 } : { allowed: true }));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const run = verifyNoPartialIncrement({ base: `http://127.0.0.1:${server.address().port}`,
        key: "synthetic-service-key", ...fixture, identityMax: 2, sourceMax: 3 });
      if (partialOnDenial) await assert.rejects(run, /partial increment/);
      else assert.deepEqual(await run, { sourceFilled: 3, deniedProbe: 1, freshIdentityGrants: 2 });
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }
});
