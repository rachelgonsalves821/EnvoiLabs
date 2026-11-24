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

All ten initial JavaScript responses used gzip; the browser's non-Echo encoded body total matches the inspector's artifact sum. The 626-byte Echo response was requested just before LCP in each sample. It is excluded only because the inspector identified its exclusive loadable module; its early request still matters to first paint. The browser reported eleven JavaScript resources, 194,149 encoded body bytes including Echo. Raw local Playwright traces and `metrics.json` are in ignored/uncommitted `.gate4-perf/`; they contain disposable-session data and are not PR artifacts. An earlier measurement used a copied build that changed during the copy; all its samples are excluded from this baseline.

The first valid run's network trace shows HTML complete near 186 ms, the two largest initial JS files complete near 1.53–1.57 seconds, and the interview session-start request begins near 3.20 seconds. The Echo request begins near 3.51 seconds. That roughly 1.6-second interval after the large initial JS responses and before the session request is a plausible client startup or hydration bottleneck under 4× CPU slowdown, not a proven root cause. Next, capture a Chromium CPU performance trace with long tasks and React hydration marks, then compare the typed-only route with Echo disabled and with the current split; move session start off the first paint path if it proves unnecessary. Repeat on the integrated WebGL implementation.

This three-sample local baseline does not meet the 20-navigation acceptance protocol. All three LCP observations exceed 2.5 seconds, and the eventual WebGL Echo must be measured after integration. The local loopback host and throttling profile are not a physical mid-range phone or a production network.
