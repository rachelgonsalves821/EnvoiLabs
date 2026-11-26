import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { readFileSync } from "node:fs";
import { test } from "node:test";

function resolvedDependency() {
  let from = createRequire(resolve("apps/web/package.json"));
  for (const name of ["inngest", "@opentelemetry/auto-instrumentations-node",
    "@opentelemetry/resource-detector-gcp", "gcp-metadata"]) {
    from = createRequire(from.resolve(name));
  }
  const metadataEntry = from.resolve("gcp-metadata");
  const gaxiosEntry = createRequire(metadataEntry).resolve("gaxios");
  let folder = dirname(gaxiosEntry);
  for (;;) {
    const manifest = resolve(folder, "package.json");
    try {
      const packageJson = JSON.parse(readFileSync(manifest, "utf8"));
      if (packageJson.name === "gaxios") return { metadataEntry, gaxiosVersion: packageJson.version };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const parent = dirname(folder);
    if (parent === folder) throw new Error("Could not resolve installed gaxios package.");
    folder = parent;
  }
}

test("Inngest GCP detector uses the overridden gaxios for a metadata request", async () => {
  const { metadataEntry, gaxiosVersion } = resolvedDependency();
  assert.equal(gaxiosVersion, "7.1.4");
  const requests = [];
  const server = createServer((request, response) => {
    requests.push({ path: request.url, flavor: request.headers["metadata-flavor"] });
    response.writeHead(200, { "Content-Type": "text/plain", "Metadata-Flavor": "Google" });
    response.end("synthetic-instance");
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing loopback listener.");
  const previousHost = process.env.GCE_METADATA_HOST;
  const previousIp = process.env.GCE_METADATA_IP;
  try {
    delete process.env.GCE_METADATA_IP;
    process.env.GCE_METADATA_HOST = `http://127.0.0.1:${address.port}`;
    const metadata = createRequire(metadataEntry)(metadataEntry);
    assert.equal(await metadata.instance("id"), "synthetic-instance");
    assert.deepEqual(requests, [{ path: "/computeMetadata/v1/instance/id", flavor: "Google" }]);
  } finally {
    if (previousHost === undefined) delete process.env.GCE_METADATA_HOST;
    else process.env.GCE_METADATA_HOST = previousHost;
    if (previousIp === undefined) delete process.env.GCE_METADATA_IP;
    else process.env.GCE_METADATA_IP = previousIp;
    await new Promise((done) => server.close(done));
  }
});
