import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { devices, expect, test } from "@playwright/test";
import { deliveredEmail, localService, loopbackOrigin } from "./support/disposable-auth";

test.skip(process.env.ENVOI_TEST_LOCAL_SUPABASE !== "1", "Requires a disposable local Auth and database stack.");
test.skip(({ browserName }) => browserName !== "chromium", "Chromium performance baseline.");

test("Gate 4 synthetic interview JS and LCP baseline", async ({ browser, baseURL }) => {
  const runsPerMode = Number(process.env.ENVOI_PERF_RUNS ?? "3");
  if (!Number.isSafeInteger(runsPerMode) || runsPerMode < 1 || runsPerMode > 50) {
    throw new Error("ENVOI_PERF_RUNS must be an integer from 1 to 50.");
  }
  const cpuProfiled = process.env.ENVOI_PERF_CPU_PROFILE === "1";
  const traceCaptured = process.env.ENVOI_PERF_TRACE !== "0";
  test.setTimeout(Math.max(240_000, runsPerMode * 2 * 60_000));
  const origin = loopbackOrigin(baseURL);
  const echoChunk = process.env.ENVOI_ECHO_CHUNK;
  const output = process.env.ENVOI_PERF_OUTPUT;
  const revision = process.env.ENVOI_PERF_REVISION;
  const buildId = process.env.ENVOI_PERF_BUILD_ID;
  if (!echoChunk?.startsWith("static/chunks/") || !output || !/^[a-f\d]{40}$/i.test(revision ?? "") || !buildId) {
    throw new Error("Configure output, Echo chunk, full revision, and production build ID.");
  }
  const service = localService();
  const email = `gate4-perf-${randomUUID()}@example.test`;
  const setup = await browser.newContext({ ...devices["Pixel 7"], baseURL: origin });

  try {
    const page = await setup.newPage();
    await page.goto("/r/signup");
    await page.getByLabel("Email address").fill(email);
    await page.getByRole("checkbox", { name: /18 or older/ }).check();
    await page.getByRole("button", { name: "Email me a sign-in link" }).click();
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
    const link = await deliveredEmail(page, email, origin, "/api/respondent/auth/callback");
    await page.goto(link.href);
    await expect(page.getByRole("heading", { name: "You’re signed in" })).toBeVisible();
    await page.getByRole("link", { name: "Profile and privacy choices" }).click();
    await page.getByLabel("What’s your age range?").selectOption("18-24");
    await page.getByLabel("How do you describe your gender?").selectOption("undisclosed");
    await page.getByLabel("Are you currently in school?").selectOption("year_2");
    await page.getByLabel("Do you live on campus?").selectOption("true");
    await page.getByLabel("How often do you shop online?").selectOption("weekly");
    await page.getByLabel("What’s your ZIP code?").fill("02139");
    await page.getByLabel("How many times do you order food in a typical week?").fill("3");
    await page.getByRole("checkbox", { name: "Food and drink" }).check();
    await page.getByRole("checkbox", { name: "Technology" }).check();
    await page.getByRole("button", { name: "Save and continue" }).click();
    await expect(page.getByRole("heading", { name: "Choose what to share" })).toBeVisible();
    for (const name of ["Record my voice answers", "Turn my voice answers into text",
      "Keep my study answers", "Share my redacted answers with researchers"]) {
      await page.getByRole("checkbox", { name }).check();
    }
    await page.getByRole("button", { name: "Save privacy choices" }).click();
    await expect(page.getByRole("heading", { name: "Your account is ready" })).toBeVisible();

    const users = await service.auth.admin.listUsers();
    const authUser = users.data?.users.find((user) => user.email === email);
    if (users.error || !authUser) throw new Error("Synthetic respondent is missing.");
    const respondent = await service.from("respondents").select("id").eq("auth_user_id", authUser.id).single();
    if (respondent.error || !respondent.data) throw new Error("Synthetic account is missing.");
    const org = await service.from("organizations").insert({ name: "Synthetic Gate 4 baseline" }).select("id").single();
    if (org.error || !org.data) throw new Error("Synthetic organization is missing.");
    const study = await service.from("studies").insert({ organization_id: org.data.id,
      title: "Synthetic performance interview", state: "fielding", target_completes: 1, length_minutes: 8,
    }).select("id").single();
    if (study.error || !study.data) throw new Error("Synthetic study is missing.");
    const guide = await service.from("guide_questions").insert([1, 2, 3, 4].map((position) => ({
      study_id: study.data.id, position, text: `Synthetic performance question ${position}`,
    })));
    if (guide.error) throw new Error("Synthetic guide is missing.");
    const invite = await service.from("invites").insert({ study_id: study.data.id,
      respondent_id: respondent.data.id, state: "invited", reward_cents: 250,
      why_you_text: "Synthetic performance fixture", expires_at: new Date(Date.now() + 3600_000).toISOString(),
    }).select("id").single();
    if (invite.error || !invite.data) throw new Error("Synthetic invite is missing.");
    await page.goto("/r");
    await page.getByRole("button", { name: "Start answering" }).click();
    await expect(page.getByRole("heading", { name: "Synthetic performance question 1" })).toBeVisible();

    const cookies = await setup.cookies();
    const samples = [];
    const modes = process.env.ENVOI_PERF_ORDER === "typed-first"
      ? (["typed", "voice"] as const) : (["voice", "typed"] as const);
    for (const mode of modes) {
      const consent = await service.from("consents").insert({ respondent_id: respondent.data.id,
        study_id: null, purpose: "recording", granted: mode === "voice", text_version: "gate1-preview-v1" });
      if (consent.error) throw new Error("Synthetic voice/typed consent fixture failed.");
      for (let index = 1; index <= runsPerMode; index++) {
        const context = await browser.newContext({ ...devices["Pixel 7"], baseURL: origin });
        try {
          await context.addCookies(cookies);
          if (traceCaptured) await context.tracing.start({ screenshots: true, snapshots: true });
          const measured = await context.newPage();
          const responseHeaders = new Map<string, { contentEncoding: string | null; contentLength: string | null }>();
          measured.on("response", (response) => {
            if (!new URL(response.url()).pathname.endsWith(".js")) return;
            const headers = response.headers();
            responseHeaders.set(new URL(response.url()).pathname, {
              contentEncoding: headers["content-encoding"] ?? null,
              contentLength: headers["content-length"] ?? null,
            });
          });
          await measured.addInitScript(() => {
            const entries: PerformanceEntry[] = [];
            const longTasks: PerformanceEntry[] = [];
            new PerformanceObserver((list) => entries.push(...list.getEntries()))
              .observe({ type: "largest-contentful-paint", buffered: true });
            new PerformanceObserver((list) => longTasks.push(...list.getEntries()))
              .observe({ type: "longtask", buffered: true });
            (window as Window & { __gate4Lcp?: PerformanceEntry[] }).__gate4Lcp = entries;
            (window as Window & { __gate4LongTasks?: PerformanceEntry[] }).__gate4LongTasks = longTasks;
          });
          const cdp = await context.newCDPSession(measured);
          await cdp.send("Network.enable");
          await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150,
            downloadThroughput: 1_600_000 / 8, uploadThroughput: 750_000 / 8 });
          await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
          if (cpuProfiled) {
            await cdp.send("Profiler.enable");
            await cdp.send("Profiler.setSamplingInterval", { interval: 1000 });
            await cdp.send("Profiler.start");
          }
          await measured.goto(`/r/interviews/${invite.data.id}`, { waitUntil: "networkidle" });
          await expect(measured.getByRole("heading", { name: "Synthetic performance question 1" })).toBeVisible();
          if (mode === "typed") await expect(measured.getByRole("textbox", { name: /answer/i })).toBeVisible();
          else await expect(measured.getByRole("button", { name: /start recording/i })).toBeVisible();
          await measured.waitForTimeout(1000);
          const sample = await measured.evaluate(() => {
            const lcp = (window as Window & { __gate4Lcp?: PerformanceEntry[] }).__gate4Lcp?.at(-1);
            const tasks = (window as Window & { __gate4LongTasks?: PerformanceEntry[] }).__gate4LongTasks ?? [];
            const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
            return { lcpMs: lcp?.startTime ?? null,
              lcpElement: (lcp as PerformanceEntry & { element?: Element })?.element?.tagName ?? null,
              longTasks: tasks.map((task) => ({ startMs: task.startTime, durationMs: task.duration })),
              js: resources.filter((entry) => new URL(entry.name).pathname.endsWith(".js"))
                .map((entry) => ({ path: new URL(entry.name).pathname, encodedBodyBytes: entry.encodedBodySize,
                  transferBytes: entry.transferSize, startMs: entry.startTime })),
            };
          });
          let topCpu: { frame: string; sampledMs: number }[] = [];
          if (cpuProfiled) {
            const { profile } = await cdp.send("Profiler.stop");
            writeFileSync(resolve(output, `cpu-${process.env.ENVOI_PERF_ORDER ?? "voice-first"}-${mode}-${index}.json`), JSON.stringify(profile));
            const nodes = new Map(profile.nodes.map((node) => [node.id, node.callFrame]));
            const cpu = new Map<string, number>();
            for (let sampleIndex = 0; sampleIndex < (profile.samples?.length ?? 0); sampleIndex++) {
              const nodeId = profile.samples?.[sampleIndex];
              if (nodeId === undefined) continue;
              const frame = nodes.get(nodeId);
              if (!frame) continue;
              const key = `${frame.functionName || "(anonymous)"} ${frame.url || ""}`.trim();
              cpu.set(key, (cpu.get(key) ?? 0) + (profile.timeDeltas?.[sampleIndex] ?? 0));
            }
            topCpu = [...cpu].sort((a, b) => b[1] - a[1]).slice(0, 10)
              .map(([frame, micros]) => ({ frame, sampledMs: Math.round(micros / 1000) }));
          }
          const unique = new Map(sample.js.map((entry) => [entry.path, entry]));
          const js = [...unique.values()].map((entry) => ({ ...entry, ...responseHeaders.get(entry.path) }));
          const echo = js.find((entry) => entry.path.endsWith(echoChunk));
          const preLcpTasks = sample.longTasks.filter((task) => sample.lcpMs !== null && task.startMs < sample.lcpMs);
          samples.push({ mode, run: index, lcpMs: sample.lcpMs, lcpElement: sample.lcpElement,
            longTaskCount: preLcpTasks.length,
            longTaskTotalMs: Math.round(preLcpTasks.reduce((sum, task) => sum + task.durationMs, 0)),
            longestTaskMs: Math.round(Math.max(0, ...preLcpTasks.map((task) => task.durationMs))),
            longTasks: preLcpTasks, topCpu,
            jsCount: js.length, jsEncodedBodyBytes: js.reduce((sum, entry) => sum + entry.encodedBodyBytes, 0),
            echoRequested: Boolean(echo), echoEncodedBodyBytes: echo?.encodedBodyBytes ?? null, js });
          if (traceCaptured) {
            await context.tracing.stop({ path: resolve(output, `trace-${process.env.ENVOI_PERF_ORDER ?? "voice-first"}-${mode}-${index}.zip`) });
          }
        } finally {
          await context.close();
        }
      }
    }
    const report = { source: "Production interview build with a disposable local respondent and invite",
      revision, buildId,
      finalWebglEcho: process.env.ENVOI_PERF_FINAL_WEBGL === "1",
      browserVersion: browser.version(), cpuProfiled, traceCaptured, runsPerMode, echoChunk,
      order: process.env.ENVOI_PERF_ORDER ?? "voice-first",
      profile: "Playwright Pixel 7 viewport, Chromium, 4x CPU slowdown, 150 ms latency, 1.6 Mbps down, 0.75 Mbps up",
      url: `/r/interviews/${invite.data.id}`, runs: samples };
    writeFileSync(resolve(output, `metrics-${cpuProfiled ? "cpu-" : ""}${report.order}.json`), JSON.stringify(report, null, 2));
    expect(samples.every((sample) => sample.lcpMs !== null && sample.jsCount > 0)).toBe(true);
  } finally {
    await setup.close();
  }
});
