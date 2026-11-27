import type { Inngest } from "inngest";
import { qualifiedAnswerEvent, uploadReceiptEvent,
} from "../../server/platform/gate3-probe-wake";

// Register only from an explicitly enabled combined Gate 1/3 caller. A
// qualified event and receipt event use different stable delivery IDs, so the
// early event cannot deduplicate the later, eligible wake.
export function gate3ProbeWakeFunction(client: Inngest,
  run: (event: { name: string; data: unknown }) => Promise<string>) {
  return client.createFunction({
    id: "gate3-dispatch-qualified-probe-answer",
    triggers: [{ event: qualifiedAnswerEvent }, { event: uploadReceiptEvent }],
    concurrency: { limit: 8 }, retries: 1,
  }, ({ event, step }) => step.run("dispatch-current-answer", () => run(event)));
}
