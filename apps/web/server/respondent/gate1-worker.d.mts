type AnswerJobStatus = Awaited<ReturnType<typeof import("@envoi-labs/ai").runGate1AnswerJob>>;

export function runConfiguredGate1AnswerJob(env: NodeJS.ProcessEnv, answerId?: string | null): Promise<AnswerJobStatus>;
