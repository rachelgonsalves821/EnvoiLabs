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

The synthetic Playwright fixture now requires an exact 40-character source revision, the production `.next/BUILD_ID`, the inspector-identified exclusive Echo chunk path, a disposable output directory, and the local Auth/database stack. `ENVOI_PERF_RUNS` controls cold navigations per voice/typed mode (default 3, maximum 50); use 20 for a future candidate. `ENVOI_PERF_CPU_PROFILE=1` enables the sampling profiler for diagnosis and marks the report as profiled; leave it off for the primary LCP series. `ENVOI_PERF_TRACE=0` suppresses raw Playwright traces when they are collected separately; the default retains traces locally. Set `ENVOI_PERF_FINAL_WEBGL=1` only after source inspection identifies the actual final WebGL implementation. These inputs are evidence labels, not proof of production parity.

Run `node tools/gate4/summarize-interview-runs.mjs <metrics.json>` on the saved report. The summarizer checks unique JavaScript resource accounting, subtracts only observed Echo bytes, separates voice and typed modes, and reports median/p75/p95 LCP and sample sufficiency. It produces a diagnostic summary and flags missing build ID, missing final WebGL identification, and fewer than 20 runs per mode. It never declares acceptance: the coordinator still needs the agreed percentile, integrated revision, representative mid-range device/network, raw traces, and final WebGL split review. Against the pinned three-run baseline above, the tool reports 3/20 samples, median LCP 2,708 ms, 193,523 non-Echo encoded JS bytes, and missing build-ID/WebGL metadata in that original JSON; the build ID was recorded separately in this document.
