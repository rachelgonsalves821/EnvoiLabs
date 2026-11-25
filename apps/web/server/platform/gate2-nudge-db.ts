import type { SupabaseClient } from "@supabase/supabase-js";
import type { NudgeCandidate, NudgeKind, NudgeQueue } from "@envoi-labs/services/nudges";
import type { Database } from "../../../../packages/db/src/database.generated";

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const kinds: readonly NudgeKind[] = ["halfway", "two_hours_left"];
function isDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}
function parseCandidate(value: unknown): NudgeCandidate {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid nudge candidate");
  const row = value as Record<string, unknown>;
  if (typeof row.inviteId !== "string" || !uuid.test(row.inviteId) ||
    typeof row.sessionId !== "string" || !uuid.test(row.sessionId) ||
    row.state !== "in_progress" || !isDate(row.expiresAt) ||
    !isDate(row.lastActivityAt) ||
    (row.snoozedUntil !== null && !isDate(row.snoozedUntil)) ||
    !Number.isSafeInteger(row.coreQuestionCount) ||
    (row.coreQuestionCount as number) < 1 ||
    !Number.isSafeInteger(row.answeredCoreCount) ||
    (row.answeredCoreCount as number) < 0 ||
    !Array.isArray(row.sentKinds) ||
    !row.sentKinds.every((kind) => kinds.includes(kind)))
    throw new Error("Invalid nudge candidate");
  return row as NudgeCandidate;
}

export function createGate2NudgeQueue(client: SupabaseClient<Database>): NudgeQueue {
  return {
    async readCandidates() {
      const { data, error } = await client.rpc("list_gate2_nudge_candidates");
      if (error) throw error;
      if (!Array.isArray(data)) throw new Error("Invalid nudge candidate list");
      return data.map(parseCandidate);
    },
    async enqueue(nudge) {
      const { data, error } = await client.rpc("queue_gate2_nudge", {
        supplied_invite_id: nudge.inviteId,
        supplied_session_id: nudge.sessionId,
        supplied_kind: nudge.kind,
        supplied_key: nudge.idempotencyKey,
      });
      if (error) throw error;
      if (typeof data !== "boolean") throw new Error("Invalid nudge claim result");
      return data;
    },
  };
}
