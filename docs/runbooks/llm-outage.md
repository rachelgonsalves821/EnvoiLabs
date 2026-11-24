# LLM outage

**Scope:** scoping, confirming screeners, live probes, and analysis as those paths arrive in Gates 2 and 3. The Gate 4 target is for an in-progress interview to continue on its approved static guide without probes when the probe provider fails. This behavior is not implemented in the current Gate 1 checkout.

## Detect and contain

1. Confirm the environment, deployed prompt and model version, error and timeout rates, affected study IDs, and last successful response. Do not log or paste respondent answers or model request bodies into the incident record.
2. Stop new LLM-dependent launches or approvals if approved screeners, guide quality, or report evidence cannot be assured. Existing interviews may continue only if the static guide fallback has passed its local and hosted checks.
3. Switch the probe path to the approved no-probe mode through the documented feature control once Gate 3 implements it. Do not improvise a model or prompt change during an incident. A late probe must not replace the next core question.

## Recover

1. Check provider status, credentials, quotas, timeouts, and recent deployments. Restore the pinned known-good model or version, or wait for provider recovery.
2. Replay only idempotent work with current consent and authorization. Keep uncertain screener outcomes in clarification or review; never treat missing model output as qualification or disqualification.
3. Before restoring probes, run a synthetic interview through a provider error and timeout, verify the guide advances without a probe, then run a normal probe and verify render timing and question order.
4. Resume scoping and analysis only after their fixture and evidence checks pass. Recheck report quotes against the current redacted transcript version.

## Close

Record affected sessions, no-probe rate, timeout rate, any delayed reports, and the exact model or prompt version restored. Do not claim the six-second p95 probe goal from a synthetic-only check.
