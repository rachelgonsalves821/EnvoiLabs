import assert from "node:assert/strict";
import { test } from "node:test";
import { checkPreviewIngress } from "./preview-ingress-check.mjs";

const url = "https://envoilabs-git-codex-gate-4-example-rachelgonsalves821s-projects.vercel.app/api/gate4/ingress-observer";
const token = "synthetic-preview-observer-token-at-least-32-bytes";

function fetcher(results, seen) {
  return async (_url, request) => {
    seen.push(request);
    return new Response(JSON.stringify(results[seen.length - 1]), {
      status: 200, headers: { "cache-control": "no-store" },
    });
  };
}

test("accepts overwritten spoof headers without disclosing values", async () => {
  const seen = [];
  const result = await checkPreviewIngress({ url, token, fetcher: fetcher([
    { sourceUsable: true, sourceEqualsSpoof: false },
    { sourceUsable: true, sourceEqualsSpoof: false },
    { sourceUsable: true, sourceEqualsSpoof: false },
  ], seen) });
  assert.equal(seen.length, 3);
  assert.equal(seen[1].headers["x-vercel-forwarded-for"], "192.0.2.71");
  assert.equal(seen[2].headers["x-vercel-forwarded-for"], "192.0.2.71, 203.0.113.73");
  assert.equal(result.spoof.sourceEqualsSpoof, false);
});

test("fails on spoof acceptance, extra response fields, and non-preview destinations", async () => {
  await assert.rejects(() => checkPreviewIngress({ url, token, fetcher: fetcher([
    { sourceUsable: true, sourceEqualsSpoof: false },
    { sourceUsable: true, sourceEqualsSpoof: true },
    { sourceUsable: true, sourceEqualsSpoof: false },
  ], []) }));
  await assert.rejects(() => checkPreviewIngress({ url, token, fetcher: fetcher([
    { sourceUsable: true, sourceEqualsSpoof: false, ip: "redacted" },
  ], []) }));
  await assert.rejects(() => checkPreviewIngress({
    url: "https://example.com/api/gate4/ingress-observer", token,
  }));
});

test("accepts an ingress rejection of the comma-list request", async () => {
  let calls = 0;
  const result = await checkPreviewIngress({ url, token, fetcher: async () => {
    calls++;
    if (calls === 3) return new Response(null, { status: 400 });
    return new Response(JSON.stringify({ sourceUsable: true, sourceEqualsSpoof: false }),
      { status: 200, headers: { "cache-control": "no-store" } });
  } });
  assert.deepEqual(result.list, { rejected: true });
});

test("sends the optional protection bypass on every request without changing spoof assertions", async () => {
  const seen = [];
  const bypass = "synthetic-protected-preview-bypass";
  await checkPreviewIngress({ url, token, protectionBypass: bypass, fetcher: fetcher([
    { sourceUsable: true, sourceEqualsSpoof: false },
    { sourceUsable: true, sourceEqualsSpoof: false },
    { sourceUsable: true, sourceEqualsSpoof: false },
  ], seen) });
  assert.deepEqual(seen.map((request) => request.headers["x-vercel-protection-bypass"]),
    [bypass, bypass, bypass]);
});
