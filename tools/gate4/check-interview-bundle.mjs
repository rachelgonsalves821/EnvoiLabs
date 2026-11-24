import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";

const route = "/(respondent)/r/interviews/[inviteId]/page";
const nextRoot = resolve(import.meta.dirname, "../../apps/web/.next");
const routeRoot = `server/app/${route.slice(1)}`;

function json(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function clientReferences(path) {
  const source = readFileSync(path, "utf8");
  const marker = `globalThis.__RSC_MANIFEST[${JSON.stringify(route)}] = `;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error("Interview client reference manifest has an unknown format.");
  const value = source.slice(start + marker.length).trim().replace(/;$/, "");
  return JSON.parse(value);
}

function size(next, file) {
  if (!/^static\/chunks\/[a-zA-Z0-9._-]+\.js$/.test(file)) {
    throw new Error(`Unexpected JavaScript chunk path: ${file}`);
  }
  const bytes = readFileSync(resolve(next, file));
  return { file, rawBytes: bytes.length, gzipBytes: gzipSync(bytes).length };
}

function echoModuleId(next, initialPaths) {
  const ids = new Set();
  for (const file of initialPaths) {
    const body = readFileSync(resolve(next, file), "utf8");
    for (const match of body.matchAll(/loadableGenerated:\{modules:\[(\d+)\]\}[\s\S]{0,400}?className:"ev-echo"/g)) {
      ids.add(match[1]);
    }
  }
  if (ids.size !== 1) throw new Error("Could not uniquely identify the Echo dynamic module in interview entry JavaScript.");
  return [...ids][0];
}

export function inspectBundle(next) {
  const routeManifest = json(resolve(next, routeRoot, "build-manifest.json"));
  const references = clientReferences(resolve(next, `server/app/${route.slice(1)}_client-reference-manifest.js`));
  const loadable = json(resolve(next, routeRoot, "react-loadable-manifest.json"));
  const entry = references.entryJSFiles ?? {};
  const routeEntries = Object.entries(entry).filter(([key]) =>
    key.endsWith("/apps/web/app/layout") || key.endsWith("/apps/web/app/(respondent)/r/layout") ||
    key.endsWith("/apps/web/app/(respondent)/r/interviews/[inviteId]/page"));
  if (routeEntries.length < 2) throw new Error("Interview entry JavaScript is missing from client references.");

  const initialPaths = [...new Set([
    ...(routeManifest.rootMainFiles ?? []),
    ...routeEntries.flatMap(([, files]) => files),
  ])];
  const echoId = echoModuleId(next, initialPaths);
  const echoEntry = loadable[echoId];
  if (!echoEntry || String(echoEntry.id) !== echoId) {
    throw new Error("Echo dynamic module is absent from the route loadable manifest.");
  }
  const echoPaths = [...new Set(echoEntry.files ?? [])];
  const otherDynamicPaths = [...new Set(Object.entries(loadable)
    .filter(([key]) => key !== echoId).flatMap(([, item]) => item.files ?? []))]
    .filter((file) => !initialPaths.includes(file));
  const exclusiveEchoPaths = echoPaths.filter((file) => !otherDynamicPaths.includes(file));
  if (initialPaths.length === 0 || exclusiveEchoPaths.length === 0 || echoPaths.some((file) => initialPaths.includes(file))) {
    throw new Error("A separate lazy Echo chunk was not found outside the initial interview JavaScript.");
  }
  const initial = initialPaths.map((file) => size(next, file));
  const echo = exclusiveEchoPaths.map((file) => size(next, file));
  const otherDynamic = otherDynamicPaths.map((file) => size(next, file));
  const observedGzipBytes = [...initial, ...otherDynamic].reduce((sum, file) => sum + file.gzipBytes, 0);
  // Next can put a tiny async wrapper around an Echo implementation already present in an entry chunk.
  const echoImplementationInInitial = initialPaths.some((file) => {
    const body = readFileSync(resolve(next, file), "utf8");
    return body.includes("Preparing a follow-up") && body.includes("ev-echo") && body.includes("Payout");
  });
  return {
    route, echoModuleId: echoId, budgetGzipBytes: 200_000, observedGzipBytes,
    withinBuildBudget: observedGzipBytes < 200_000,
    echoImplementationInInitial,
    initial, otherDynamic, excludedLazyEcho: echo,
    note: "Build-artifact estimate includes other dynamic chunks conservatively. Echo code detection uses current state labels; verify browser-requested JS, lazy timing, and LCP before acceptance.",
  };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const next = process.argv.length === 4 && process.argv[2] === "--build-dir"
    ? resolve(process.argv[3]) : nextRoot;
  try {
    if (!existsSync(next)) throw new Error("No production build output. Run the web production build first.");
    const result = inspectBundle(next);
    console.log(JSON.stringify(result, null, 2));
    if (!result.withinBuildBudget || result.echoImplementationInInitial) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Bundle inspection failed.");
    process.exitCode = 2;
  }
}
