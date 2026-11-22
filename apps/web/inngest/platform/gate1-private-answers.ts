import { cron, NonRetriableError, type Inngest } from "inngest";
import { drainPrivateGate1Answers } from "../../server/platform/gate1-private-answers";
import { runConfiguredGate1AnswerJob } from "../../server/respondent/gate1-worker.mjs";

export function gate1PrivateAnswersFunction(client: Inngest) {
  return client.createFunction({
    id: "gate1-drain-private-answers",
    triggers: [cron("*/5 * * * *")],
    concurrency: { limit: 1 },
    retries: 3,
  }, ({ event, step }) => {
    if (event.name !== "inngest/scheduled.timer") throw new NonRetriableError("The private answer queue requires the scheduled trigger.");
    return drainPrivateGate1Answers((id, runNext) => step.run(id, runNext), () => runConfiguredGate1AnswerJob(process.env));
  });
}
