import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, test } from "node:test";
import { inspectBundle } from "./check-interview-bundle.mjs";

const route = "/(respondent)/r/interviews/[inviteId]/page";
const temporary = [];

afterEach(() => {
  for (const path of temporary.splice(0)) {
    const absolute = resolve(path);
    assert.ok(absolute.startsWith(resolve(tmpdir(), "envoi-gate4-")));
    rmSync(absolute, { recursive: true, force: true });
  }
});

function fixture(echoInEntry = false, sharedEcho = false) {
  const next = mkdtempSync(join(tmpdir(), "envoi-gate4-"));
  temporary.push(next);
  const put = (path, body) => {
    const target = resolve(next, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, body);
  };
  const routeDir = `server/app/${route.slice(1)}`;
  put(`${routeDir}/build-manifest.json`, JSON.stringify({ rootMainFiles: ["static/chunks/runtime.js"] }));
  put(`${routeDir}/react-loadable-manifest.json`, JSON.stringify({
    75233: { id: 75233, files: ["static/chunks/echo.js"] },
    54321: { id: 54321, files: sharedEcho
      ? ["static/chunks/chart.js", "static/chunks/echo.js"] : ["static/chunks/chart.js"] },
  }));
  put(`server/app/${route.slice(1)}_client-reference-manifest.js`,
    `globalThis.__RSC_MANIFEST = globalThis.__RSC_MANIFEST || {};\n` +
    `globalThis.__RSC_MANIFEST[${JSON.stringify(route)}] = ${JSON.stringify({ entryJSFiles: {
      "[project]/apps/web/app/layout": ["static/chunks/runtime.js"],
      "[project]/apps/web/app/(respondent)/r/layout": ["static/chunks/shared.js"],
      "[project]/apps/web/app/(respondent)/r/interviews/[inviteId]/page": ["static/chunks/page.js"],
    } })};\n`);
  put("static/chunks/runtime.js", "runtime");
  put("static/chunks/shared.js", "shared");
  put("static/chunks/page.js", 'loadableGenerated:{modules:[75233]},ssr:!1,loading:()=>({className:"ev-echo"})' +
    (echoInEntry ? " ev-echo Preparing a follow-up Payout" : " interview"));
  put("static/chunks/echo.js", "lazy Echo implementation");
  put("static/chunks/chart.js", "unrelated dynamic chart implementation");
  return next;
}

test("includes shared route JavaScript and excludes a separate Echo chunk", () => {
  const result = inspectBundle(fixture());
  assert.deepEqual(result.initial.map((item) => item.file), [
    "static/chunks/runtime.js", "static/chunks/shared.js", "static/chunks/page.js",
  ]);
  assert.deepEqual(result.excludedLazyEcho.map((item) => item.file), ["static/chunks/echo.js"]);
  assert.deepEqual(result.otherDynamic.map((item) => item.file), ["static/chunks/chart.js"]);
  assert.equal(result.echoModuleId, "75233");
  assert.equal(result.observedGzipBytes,
    [...result.initial, ...result.otherDynamic].reduce((sum, item) => sum + item.gzipBytes, 0));
  assert.equal(result.echoImplementationInInitial, false);
});

test("detects a lazy wrapper whose Echo implementation is still in entry JavaScript", () => {
  assert.equal(inspectBundle(fixture(true)).echoImplementationInInitial, true);
});

test("does not exclude a chunk shared with another dynamic module", () => {
  assert.throws(() => inspectBundle(fixture(false, true)), /separate lazy Echo chunk/);
});
