export type ScreeningQuestion = { ruleId: string; ruleVersion: number;
  question: string; status: "unanswered" | "pending_review" | "clarify" |
    "review" | "qualify" | "screen_out" };
export type ScreeningSheet = { inviteId: string; studyId: string;
  expiresAt: string; questions: ScreeningQuestion[] };
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const statuses = new Set(["unanswered", "pending_review", "clarify", "review",
  "qualify", "screen_out"]);
export function parseScreeningSheet(input: unknown): ScreeningSheet | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const row = input as Record<string, unknown>;
  if (typeof row.inviteId !== "string" || !uuid.test(row.inviteId) ||
    typeof row.studyId !== "string" || !uuid.test(row.studyId) ||
    typeof row.expiresAt !== "string" || !Number.isFinite(Date.parse(row.expiresAt)) ||
    !Array.isArray(row.questions) || row.questions.length > 3) return null;
  const questions: ScreeningQuestion[] = [];
  for (const raw of row.questions) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const item = raw as Record<string, unknown>;
    if (typeof item.ruleId !== "string" || !uuid.test(item.ruleId) ||
      !Number.isSafeInteger(item.ruleVersion) || (item.ruleVersion as number) < 1 ||
      typeof item.question !== "string" || item.question.length > 1000 ||
      !item.question.trim() || !statuses.has(String(item.status))) return null;
    questions.push({ ruleId: item.ruleId, ruleVersion: item.ruleVersion as number,
      question: item.question, status: item.status as ScreeningQuestion["status"] });
  }
  return { inviteId: row.inviteId, studyId: row.studyId,
    expiresAt: row.expiresAt, questions };
}
