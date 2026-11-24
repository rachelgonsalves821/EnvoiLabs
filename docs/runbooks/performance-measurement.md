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
