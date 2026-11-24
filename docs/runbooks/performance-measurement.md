# Interview performance measurement plan

The Gate 4 build plan requires interview LCP below 2.5 seconds on a mid-range phone profile and under 200 KB gzipped JavaScript, excluding a lazy Echo chunk. Run these measurements on the same integrated production revision and record the SHA, Next version, device, browser, network, sample count, and raw trace files.

## Build-artifact inspection

1. Build the integrated web app in production mode. Run `node tools/gate4/check-interview-bundle.mjs` from the repository root. The inspector reads Next 16 route-level `build-manifest.json`, the client-reference manifest, and the route's React loadable manifest. It deduplicates root and route client chunks before summing their gzipped artifact sizes.
2. Treat the output as a diagnostic. A separate React loadable file is insufficient if the Echo implementation is still in an initial chunk. The inspector flags the current CSS Echo state-label implementation when it appears in initial JavaScript. Rebuild after Gate 2's edit or the eventual WebGL Echo implementation and inspect the code split again.
3. Run the interview in a browser with an authenticated synthetic respondent and an eligible synthetic invite. Capture every JavaScript request from a cold navigation through the first interactive question, including framework and shared chunks. Save requested URL, transfer encoding, compressed response bytes, initiator and start time. Sum unique compressed JS responses. Identify the Echo chunk by the dynamic module and verify it is fetched only through the lazy boundary. Compare this observed total with the artifact estimate and investigate missing or extra chunks.
4. Repeat after first voice activation to record Echo transfer and rendering cost separately. The 200 KB exclusion applies only to the actual Echo chunk, not to shared code that happens to export Echo.

## LCP

Use a documented mid-range Android device profile for the acceptance run; a physical device is preferable. If an emulator is used, record CPU slowdown, viewport, device scale factor, 4G latency and throughput, cache state, and host. Use production hosting or a representative local network, never Next dev mode. Precreate the synthetic account and invite so authentication and setup time do not pollute interview navigation.

Record at least 20 cold navigations from the interview route to the first usable question. Capture the browser's LCP entry, element, time, and request waterfall for each; report median, p75, p95, failures, and whether Echo was requested before LCP. The acceptance threshold is under 2.5 seconds for the agreed measured percentile; the coordinator must record that percentile before declaring a pass. Verify voice and typed paths and a no-WebGL or reduced-motion fallback after the initial measurement.

The Gate 2 branch currently produces a route-level manifest and a 227-byte lazy wrapper. The artifact inspector finds Echo's CSS implementation in an initial chunk. The manifest-listed initial sum is 193,631 gzipped bytes on that branch, only 6,369 bytes below the budget. These numbers are a single local build observation, not browser transfer or LCP evidence.
