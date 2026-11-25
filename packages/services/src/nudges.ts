export type NudgeKind = "halfway" | "two_hours_left";
export type NudgeCandidate = {
  inviteId: string;
  sessionId: string;
  state: "in_progress" | "submitted" | "quality_hold" | "approved" | "removed" | "paid" | "abandoned";
  expiresAt: string;
  coreQuestionCount: number;
  answeredCoreCount: number;
  lastActivityAt: string;
  snoozedUntil: string | null;
  sentKinds: readonly NudgeKind[];
};
export type DueNudge = { inviteId: string; sessionId: string;
  kind: NudgeKind; idempotencyKey: string; title: string; body: string };

const hours = (count: number) => count * 60 * 60 * 1000;
const date = (value: string) => Date.parse(value);

export function selectDueNudge(candidate: NudgeCandidate,
  now: () => Date = () => new Date()): DueNudge | null {
  const current = now().getTime();
  const expiry = date(candidate.expiresAt);
  const activity = date(candidate.lastActivityAt);
  const snoozed = candidate.snoozedUntil === null ? null : date(candidate.snoozedUntil);
  if (!Number.isFinite(current) || !Number.isFinite(expiry) || !Number.isFinite(activity) ||
    (snoozed !== null && !Number.isFinite(snoozed)) ||
    candidate.state !== "in_progress" || !candidate.inviteId || !candidate.sessionId ||
    !Number.isSafeInteger(candidate.coreQuestionCount) || candidate.coreQuestionCount < 1 ||
    !Number.isSafeInteger(candidate.answeredCoreCount) || candidate.answeredCoreCount < 0 ||
    candidate.answeredCoreCount >= candidate.coreQuestionCount ||
    activity > current || expiry <= current || (snoozed !== null && snoozed > current)) return null;

  let kind: NudgeKind;
  if (current >= expiry - hours(2) && !candidate.sentKinds.includes("two_hours_left")) {
    kind = "two_hours_left";
  } else if (current < expiry - hours(2) &&
    candidate.answeredCoreCount >= Math.ceil(candidate.coreQuestionCount / 2) &&
    current >= activity + hours(2) && !candidate.sentKinds.includes("halfway")) {
    kind = "halfway";
  } else return null;
  return { inviteId: candidate.inviteId, sessionId: candidate.sessionId, kind,
    idempotencyKey: `gate2-nudge:${candidate.inviteId}:${kind}`,
    title: kind === "halfway" ? "You’re halfway through" : "Two hours left",
    body: kind === "halfway" ? "Continue your study where you stopped."
      : "Finish your study before its offer expires." };
}

export type NudgeQueue = {
  readCandidates(): Promise<NudgeCandidate[]>;
  // A transaction must recheck current state and uniquely claim idempotencyKey.
  enqueue(nudge: DueNudge): Promise<boolean>;
};

export async function queueDueNudges(queue: NudgeQueue, now: () => Date = () => new Date()) {
  const candidates = await queue.readCandidates();
  let queued = 0;
  let unavailable = 0;
  for (const candidate of candidates) {
    const due = selectDueNudge(candidate, now);
    if (!due) continue;
    try {
      if (await queue.enqueue(due)) queued += 1;
    } catch { unavailable += 1; }
  }
  return { considered: candidates.length, queued, unavailable };
}
