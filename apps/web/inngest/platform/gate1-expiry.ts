import { cron, NonRetriableError, type Inngest } from "inngest";
import { trustedClient } from "../../server/auth/supabase";
import { runGate1Expiry } from "../../server/platform/gate1-expiry";
import { runGate1OrphanAudioCleanup } from "../../server/platform/gate1-orphan-audio";
import { audioBucket } from "../../server/respondent/private-audio";

export function gate1ExpiryFunction(client: Inngest, orphanAudioEnabled: boolean) {
  return client.createFunction({
    id: "gate1-expire-interviews",
    triggers: [cron("*/5 * * * *")],
    concurrency: { limit: 1 },
    retries: 3,
  }, async ({ event, step }) => {
    if (event.name !== "inngest/scheduled.timer") throw new NonRetriableError("Gate 1 expiry requires the scheduled trigger.");
    const expired = await step.run("expire-due-interviews", () => runGate1Expiry(event.ts, trustedClient()));
    if (!orphanAudioEnabled) return expired;

    const cleanup = await step.run("remove-expired-unconfirmed-audio", () => {
      const database = trustedClient();
      if (!database) throw new Error("Gate 1 cleanup database is unavailable.");
      return runGate1OrphanAudioCleanup({
        list: (supplied_limit) => database.rpc("list_gate1_expired_audio", { supplied_limit }),
        remove: (paths) => database.storage.from(audioBucket).remove(paths),
      });
    });
    return { ...expired, orphanAudioRequested: cleanup.requested };
  });
}
