import { cron, NonRetriableError, type Inngest } from "inngest";
import { trustedClient } from "../../server/auth/supabase";
import { runGate1Expiry } from "../../server/platform/gate1-expiry";

export function gate1ExpiryFunction(client: Inngest) {
  return client.createFunction({
    id: "gate1-expire-interviews",
    triggers: [cron("*/5 * * * *")],
    concurrency: { limit: 1 },
    retries: 3,
  }, ({ event, step }) => {
    if (event.name !== "inngest/scheduled.timer") throw new NonRetriableError("Gate 1 expiry requires the scheduled trigger.");
    return step.run("expire-due-interviews", () => runGate1Expiry(event.ts, trustedClient()));
  });
}
