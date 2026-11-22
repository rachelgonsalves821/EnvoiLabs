import type { runConfiguredGate1AnswerJob } from "../respondent/gate1-worker.mjs";

type AnswerJobStatus = Awaited<ReturnType<typeof runConfiguredGate1AnswerJob>>;
type RunStep = (id: string, processAnswer: () => Promise<boolean>) => Promise<boolean>;

const maxAnswersPerRun = 4;

export async function drainPrivateGate1Answers(runStep: RunStep, runNext: () => Promise<AnswerJobStatus>) {
  let examined = 0;
  for (let index = 0; index < maxAnswersPerRun; index++) {
    const found = await runStep(`process-answer-${index + 1}`, async () => {
      try {
        return await runNext() !== "idle";
      } catch {
        // Database and worker errors can carry private input in their cause.
        throw new Error("The private answer queue could not be checked.");
      }
    });
    if (!found) break;
    examined++;
  }
  return { examined };
}
