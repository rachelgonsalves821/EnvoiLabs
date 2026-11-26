import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const route = "/api/gate4/ingress-observer";
const spoofHeaders = {
  "x-vercel-forwarded-for": "192.0.2.71",
  "x-forwarded-for": "198.51.100.72",
  "x-real-ip": "203.0.113.73",
};

function previewUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" ||
      !/^envoilabs-[a-z0-9-]+-rachelgonsalves821s-projects\.vercel\.app$/.test(url.hostname) ||
      url.port || url.pathname !== route || url.search || url.hash || url.username || url.password) {
    throw new Error("Expected an HTTPS Vercel preview observer URL.");
  }
  return url;
}

async function observe(fetcher, url, token, bypass, headers = {}, allowIngressReject = false) {
  const response = await fetcher(url, {
    method: "GET", cache: "no-store", redirect: "error",
    headers: { Authorization: `Bearer ${token}`,
      ...(bypass ? { "x-vercel-protection-bypass": bypass } : {}), ...headers },
  });
  if (allowIngressReject && [400, 403, 431].includes(response.status)) return { rejected: true };
  assert.equal(response.status, 200, "Preview observer was unavailable.");
  assert.equal(response.headers.get("cache-control"), "no-store");
  const result = await response.json();
  assert.deepEqual(Object.keys(result).sort(), ["sourceEqualsSpoof", "sourceUsable"]);
  assert.equal(typeof result.sourceUsable, "boolean");
  assert.equal(typeof result.sourceEqualsSpoof, "boolean");
  return result;
}

export async function checkPreviewIngress({ url, token, protectionBypass, fetcher = fetch }) {
  const target = previewUrl(url);
  assert.ok(typeof token === "string" && Buffer.byteLength(token) >= 32,
    "A disposable preview observer token is required.");
  if (protectionBypass !== undefined) {
    assert.ok(typeof protectionBypass === "string" && protectionBypass.length > 0,
      "A nonempty preview protection bypass value is required.");
  }
  const baseline = await observe(fetcher, target, token, protectionBypass);
  const spoof = await observe(fetcher, target, token, protectionBypass, spoofHeaders);
  const list = await observe(fetcher, target, token, protectionBypass,
    { ...spoofHeaders, "x-vercel-forwarded-for": "192.0.2.71, 203.0.113.73" }, true);
  assert.equal(baseline.sourceUsable, true, "Baseline source was unavailable.");
  assert.equal(spoof.sourceUsable, true, "Spoof request had no usable platform source.");
  assert.equal(spoof.sourceEqualsSpoof, false, "Client supplied spoof reached the trusted source.");
  if (!list.rejected) {
    assert.equal(list.sourceUsable, true, "Comma-list request had no usable platform source.");
    assert.equal(list.sourceEqualsSpoof, false, "Comma-list spoof reached the trusted source.");
  }
  return { baseline, spoof, list };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    await checkPreviewIngress({ url: process.env.GATE4_OBSERVER_URL,
      token: process.env.GATE4_OBSERVER_TOKEN,
      protectionBypass: process.env.GATE4_PROTECTION_BYPASS });
    process.stdout.write("Hosted preview ingress spoof check passed.\n");
  } catch (error) {
    // Do not print exception details: fetch errors can include URLs or headers.
    process.stderr.write(`Hosted preview ingress spoof check failed: ${error.name}.\n`);
    process.exitCode = 1;
  }
}
