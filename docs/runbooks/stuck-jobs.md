# Stuck jobs

**Scope:** queued answer processing, interview expiry, and later Gate 2 or Gate 3 jobs. The existing Gate 1 Inngest functions are `gate1-drain-private-answers` and `gate1-expire-interviews`; each runs every five minutes with concurrency one and three retries. The private answer drain examines at most four answers per run.

## Triage

1. Confirm environment, deployment revision, scheduler health, last successful run, oldest eligible work, attempt count, and failure class. Use job and answer IDs only in shared incident notes.
2. Check whether the job was intentionally disabled. The Gate 1 functions require `ENVOI_GATE1_EXPIRY_ENABLED=1` or `ENVOI_GATE1_PRIVATE_ANSWERS_ENABLED=1`, plus the required database and Inngest configuration. Do not enable a function in an unapproved environment.
3. Compare enqueue rate with drain capacity. A backlog above capacity needs an approved capacity change; repeated manual runs can amplify provider traffic and cost.
4. For answer work, distinguish transcription failure, redaction failure, missing consent, stale lease, and database failure. Redaction qualification is still a Gate 1 acceptance dependency. Never publish a raw or unqualified transcript to clear a queue.

## Recover

1. Fix the dependency first. Restore the approved provider or database connection, or roll back the faulty deployment. For an unknown provider outcome, reconcile before replaying.
2. Replay through the normal scheduler or the service's scoped retry path. Keep the original logical work ID. Do not edit rows directly to force a completed or published state.
3. Watch the oldest-work age, retry rate, and terminal failures until the backlog clears. Confirm lease validation and current authorization still prevent stale or withdrawn work from publishing.
4. For expiry jobs, verify that due invites expire and affected sessions become abandoned once. For answers, verify one durable result per answer and that researcher access remains limited to qualified redacted text.

## Close

Record cause, affected count, maximum backlog age, data access checks, and whether any work requires a new study or respondent action. Add an alert or capacity change if the same failure could recur.
