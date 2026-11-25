# Interview performance measurement plan

The Gate 4 build plan requires interview LCP below 2.5 seconds on a mid-range phone profile and under 200 KB gzipped JavaScript, excluding a lazy Echo chunk. Run these measurements on the same integrated production revision and record the SHA, Next version, device, browser, network, sample count, and raw trace files.

## Build-artifact inspection

1. Build the integrated web app in production mode. Run `node tools/gate4/check-interview-bundle.mjs` from the repository root. The inspector reads Next 16 route-level `build-manifest.json`, the client-reference manifest, and the route's React loadable manifest. It finds the Echo dynamic module ID from the interview entry code, excludes only its exclusive chunk, and counts other dynamic chunks conservatively. It deduplicates root and route client chunks before summing their gzipped artifact sizes.
2. Treat the output as a diagnostic. A separate React loadable file is insufficient if the Echo implementation is still in an initial chunk. The inspector checks the current CSS Echo state-label implementation, but that marker must be updated for the later WebGL Echo. Rebuild after Gate 2's edit or the eventual WebGL implementation and inspect the code split again.
3. Run the interview in a browser with an authenticated synthetic respondent and an eligible synthetic invite. Capture every JavaScript request from a cold navigation through the first interactive question, including framework and shared chunks. Save requested URL, transfer encoding, compressed response bytes, initiator and start time. Sum unique compressed JS responses. Identify the Echo chunk by the dynamic module and verify it is fetched only through the lazy boundary. Compare this observed total with the artifact estimate and investigate missing or extra chunks.
4. Repeat after first voice activation to record Echo transfer and rendering cost separately. The 200 KB exclusion applies only to the actual Echo chunk, not to shared code that happens to export Echo.

## LCP

Use a documented mid-range Android device profile for the acceptance run; a physical device is preferable. If an emulator is used, record CPU slowdown, viewport, device scale factor, 4G latency and throughput, cache state, and host. Use production hosting or a representative local network, never Next dev mode. Precreate the synthetic account and invite so authentication and setup time do not pollute interview navigation.

Record at least 20 cold navigations from the interview route to the first usable question. Capture the browser's LCP entry, element, time, and request waterfall for each; report median, p75, p95, failures, and whether Echo was requested before LCP. The acceptance threshold is under 2.5 seconds for the agreed measured percentile; the coordinator must record that percentile before declaring a pass. Verify voice and typed paths and a no-WebGL or reduced-motion fallback after the initial measurement.

On an earlier Gate 2 build, Echo remained in initial JavaScript. On the later Gate 2 Echo split build, the inspector identifies Echo module `75233`, an exclusive 404-byte gzipped chunk, zero other dynamic chunks, and 193,482 gzipped bytes of counted JavaScript. The state-label implementation is absent from the initial chunks in that build. This is a single local build observation, not browser transfer, final WebGL separation, or LCP evidence.

## Pinned synthetic browser baseline, 2026-11-23

Gate 4 archived Gate 2 commit `4807570863ddeb6dc229a834e553a40cf7afb2a9` in its own checkout, installed the locked dependencies, and built with Next 16.4.6. The build ID is `98RQUbiqlnlLGb1s8BHlI`. Inspector output on this exact build: Echo module `77468`, exclusive lazy file `static/chunks/05gdu88csxinw.js` (404 gzip bytes on disk), and 193,523 gzip bytes of counted initial JavaScript. The revision differs from the earlier local build above, so its chunk IDs and byte totals are expected to differ.

The disposable local Supabase stack served one synthetic respondent and invite. `apps/web/e2e/gate4-performance.spec.ts` ran three fresh browser contexts with Playwright 1.58.2 Chromium 145.0.7632.6, Pixel 7 viewport/device scale, 4× CPU slowdown, 150 ms latency, 1.6 Mbps down, and 0.75 Mbps up against `next start` at `127.0.0.1:3100`. Each context navigated directly to the first interview question with its own empty HTTP cache. The LCP element was `H1` in all three runs.

| Run | LCP | Requested JS, excluding Echo | Echo request start | Echo response |
| --- | ---: | ---: | ---: | ---: |
| 1 | 3,560 ms | 193,523 encoded bytes | 3,496 ms | 626 encoded bytes, no content encoding |
| 2 | 2,708 ms | 193,523 encoded bytes | 2,650 ms | 626 encoded bytes, no content encoding |
| 3 | 2,552 ms | 193,523 encoded bytes | 2,505 ms | 626 encoded bytes, no content encoding |

All ten initial JavaScript responses used gzip; the browser's non-Echo encoded body total matches the inspector's artifact sum. The 626-byte Echo response was requested just before LCP in each sample. It is excluded only because the inspector identified its exclusive loadable module; its early request still matters to first paint. The browser reported eleven JavaScript resources, 194,149 encoded body bytes including Echo. Raw local Playwright traces and `metrics.json` are in ignored/uncommitted `apps/web/.next/gate4-perf/`; they contain disposable-session data and are not PR artifacts. An earlier measurement used a copied build that changed during the copy; all its samples are excluded from this baseline.

The first valid run's network trace shows HTML complete near 186 ms, the two largest initial JS files complete near 1.53–1.57 seconds, and the interview session-start request begins near 3.20 seconds. The Echo request begins near 3.51 seconds. That roughly 1.6-second interval after the large initial JS responses and before the session request is a plausible client startup or hydration bottleneck under 4× CPU slowdown, not a proven root cause. Next, capture a Chromium CPU performance trace with long tasks and React hydration marks, then compare the typed-only route with Echo disabled and with the current split; move session start off the first paint path if it proves unnecessary. Repeat on the integrated WebGL implementation.

This three-sample local baseline does not meet the 20-navigation acceptance protocol. All three LCP observations exceed 2.5 seconds, and the eventual WebGL Echo must be measured after integration. The local loopback host and throttling profile are not a physical mid-range phone or a production network.

## CPU and typed-only comparison on the same pinned build

On the same build and disposable local stack, the test captured Chromium sampling profiles and browser long tasks for the interview's real consent-controlled voice and typed-only paths. It ran three navigations per mode in voice-first order and three more per mode in typed-first order. Each navigation used a fresh browser context and the same Pixel 7/4× CPU/150 ms/1.6 Mbps profile. The profiler itself adds overhead, so these LCP values are a separate diagnostic series from the three-run baseline above.

| Order | Voice LCP (ms) | Typed-only LCP (ms) | Voice/typed median (ms) |
| --- | --- | --- | --- |
| Voice first | 2,192 / 2,420 / 2,392 | 2,516 / 2,364 / 2,644 | 2,392 / 2,516 |
| Typed first | 2,396 / 2,560 / 2,436 | 2,332 / 2,480 / 2,436 | 2,436 / 2,436 |

Across both orders, the voice median was 2,408 ms and typed-only median 2,458 ms; three of twelve observations exceeded 2.5 seconds. All twelve runs had three long tasks before LCP. Their total duration ranged from 419–722 ms in voice mode and 551–796 ms in typed mode; median totals were 612 and 674 ms respectively. The tasks clustered near 0.53–0.55 seconds, 1.53–1.56 seconds, and 1.78–1.92 seconds after navigation. Sampled CPU time concentrated in Chromium's `(program)`, minified Turbopack runtime, and initial app chunks; the profile does not identify a specific React component as the cause.

The voice path requested the separate 626-byte encoded Echo chunk in all six runs; typed-only requested none. Non-Echo JavaScript remained 193,523 encoded bytes in both modes. In the first order's request waterfalls, the two largest initial JS responses ended near 1.53–1.56 seconds; the session-start request began near 1.96–2.41 seconds and the Echo request began near 2.18–2.40 seconds in voice mode. The question `H1` appears only after the client starts the session. These observations make client startup and the session-start dependency a more testable first-paint target than the tiny CSS Echo chunk, but the small noisy sample cannot establish causation.

Gate 2 respondent UI handoff: add marks around hydration, `InterviewView`'s session-start effect, response parsing, and question paint. Compare the existing path with a safe earlier session fetch or server-rendered first question, preserving invite, consent, idempotency, and session authorization checks. Profile long tasks again and require a 20-run mid-range LCP improvement without increasing initial JS or causing an early Echo request. The final WebGL Echo also needs a separate split/transfer recheck. Raw synthetic CPU profiles and browser traces remain local in ignored `apps/web/.next/gate4-perf/`.

## Reusable local measurement fixture

## Probe UI and Echo split integration finding, 2026-11-24

Gate 4 built a disposable local merge of Gate 2 probe UI draft `f8b97736285a1ea0af09171b21daf7139a3d01ea` and its CSS Echo split draft `4807570863ddeb6dc229a834e553a40cf7afb2a9` (synthetic merge `b8d6d011ce0f44369c64a4e33863e9d5173b39c6`). The production Next build succeeded, build ID `cTAh4AgOKGA0lXSU1NvKk`. The inspector counted 194,162 gzipped initial bytes, below its artifact budget, but correctly reported `echoImplementationInInitial: true`. The 222-byte exclusive lazy chunk was only a wrapper around Echo code already in an initial chunk. This is a **failed Echo separation check** despite the byte total.

The new `probe-text-answer.tsx` imports `Button` from the top-level `@envoi-labs/ui` barrel. That barrel exports `Echo`. Gate 4 changed only that import to `@envoi-labs/ui/primitives` in the disposable merge worktree and rebuilt successfully (build ID `n_e1378t3tQc7ogXv1gpq`). The same inspector then counted 194,014 gzipped initial bytes and reported `echoImplementationInInitial: false`; the lazy Echo wrapper remained separate. This is a narrow, reproducible Gate 2 UI fix request. The disposable source edit is not on the Gate 4 PR or the Gate 2 owner branch. Gate 2 should apply it and verify the eventual WebGL Echo implementation is absent from all initial chunks after integration.

The two build inspections alone did not establish browser-requested transfer or LCP. The local browser check below adds those diagnostics; repeat the 20-run cold mobile protocol after the final WebGL UI lands. Keep the previous 2.5-second misses visible until a passing integrated measurement replaces them.

Gate 4 then ran the existing synthetic browser fixture on the **corrected disposable merge** commit `436d38e015f70eeefb13c9ab7cd75db3a054b6ba`, production build `n_e1378t3tQc7ogXv1gpq`. A fresh local Supabase 2.84.2 stack held one fictional respondent and invite; Playwright Chromium 145.0.7632.6 used Pixel 7 dimensions, 4× CPU slowdown, 150 ms latency, 1.6 Mbps down and 0.75 Mbps up. Each of three voice and three typed navigations used a fresh browser context with an empty HTTP cache. The browser requested 194,014 encoded non-Echo JS bytes in every run, matching the build inspector. Voice runs additionally requested the exclusive Echo chunk (626 encoded bytes) near 2,430 / 2,408 / 2,386 ms; typed runs requested no Echo chunk. The first question H1 was the LCP element throughout.

| Mode | Three cold LCP observations | Median | Pre-LCP long-task totals |
| --- | --- | ---: | --- |
| Voice | 2,468 / 2,448 / 2,460 ms | 2,460 ms | 726 / 644 / 628 ms |
| Typed | 2,508 / 2,660 / 2,424 ms | 2,508 ms | 727 / 877 / 642 ms |

The corrected CSS Echo split is therefore visible in actual browser requests, but two typed samples still exceed 2.5 seconds and the voice Echo request starts shortly before LCP. The 148-byte artifact reduction from the one-line import change is not evidence of a causal LCP improvement: this small series used fresh fixtures and cannot be compared as a controlled before/after timing test. The eventual WebGL implementation, integrated branch, agreed percentile, representative network and 20 cold runs remain required for acceptance. Raw metrics remain only in the ignored disposable worktree; local services and their container were stopped after the run.

The synthetic Playwright fixture now requires an exact 40-character source revision, the production `.next/BUILD_ID`, the inspector-identified exclusive Echo chunk path, a disposable output directory, and the local Auth/database stack. `ENVOI_PERF_RUNS` controls cold navigations per voice/typed mode (default 3, maximum 50); use 20 for a future candidate. `ENVOI_PERF_CPU_PROFILE=1` enables the sampling profiler for diagnosis and marks the report as profiled; leave it off for the primary LCP series. `ENVOI_PERF_TRACE=0` suppresses raw Playwright traces when they are collected separately; the default retains traces locally. Set `ENVOI_PERF_FINAL_WEBGL=1` only after source inspection identifies the actual final WebGL implementation. These inputs are evidence labels, not proof of production parity.

Run `node tools/gate4/summarize-interview-runs.mjs <metrics.json>` on the saved report. The summarizer checks unique JavaScript resource accounting, subtracts only observed Echo bytes, separates voice and typed modes, and reports median/p75/p95 LCP and sample sufficiency. It produces a diagnostic summary and flags missing build ID, missing final WebGL identification, and fewer than 20 runs per mode. It never declares acceptance: the coordinator still needs the agreed percentile, integrated revision, representative mid-range device/network, raw traces, and final WebGL split review. Against the pinned three-run baseline above, the tool reports 3/20 samples, median LCP 2,708 ms, 193,523 non-Echo encoded JS bytes, and missing build-ID/WebGL metadata in that original JSON; the build ID was recorded separately in this document.

## Respondent Earnings layout preparation, 2026-11-24

Gate 2 committed a feature-gated Earnings screen at `31a43af81a8ddb5dceb525fac331e87dd002176c`. Gate 4 rendered its current summary/list/referral markup with the committed UI tokens, card and respondent CSS in local headless Chrome 158.0.8127.37. The fictional values included `$1,999.99` in both summary cards, a failed $300 study reward and a vested $5 referral. At 320, 360, 390 and 430 CSS pixels, document scroll width equaled viewport width, neither summary amount overflowed its card, and the back link was 44 CSS pixels high. Summary card widths were 138, 158, 173 and 193 pixels respectively. The temporary fixture and browser data were removed after retaining this non-sensitive result.

This checks CSS layout only. It did not render the authenticated Next route, load the actual Manrope font, verify a second account, test the eventual Earnings home link in a browser, or measure the interview LCP/JS budget. Repeat on the integrated route with current RPC data and the final mobile profile before calling the respondent surface ready.
