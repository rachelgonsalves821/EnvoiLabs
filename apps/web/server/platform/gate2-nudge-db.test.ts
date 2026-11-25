import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../../../packages/db/src/database.generated";
import { queueDueNudges } from "@envoi-labs/services/nudges";
import { createGate2NudgeQueue } from "./gate2-nudge-db";

const inviteId = "a9870000-0000-4000-8000-000000000002";
const sessionId = "a9870000-0000-4000-8000-000000000003";
const candidate = { inviteId, sessionId, state: "in_progress",
  expiresAt: "2026-11-24T16:00:00Z", coreQuestionCount: 5,
  answeredCoreCount: 3, lastActivityAt: "2026-11-24T10:00:00Z",
  snoozedUntil: null, sentKinds: [] };

describe("private Gate 2 nudge adapter", () => {
  it("passes the stable key through the transactional claim and queues once", async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: [candidate], error: null })
      .mockResolvedValueOnce({ data: true, error: null });
    const queue = createGate2NudgeQueue({ rpc } as unknown as SupabaseClient<Database>);
    expect(await queueDueNudges(queue, () => new Date("2026-11-24T13:00:00Z")))
      .toEqual({ considered: 1, queued: 1, unavailable: 0 });
    expect(rpc).toHaveBeenLastCalledWith("queue_gate2_nudge", {
      supplied_invite_id: inviteId, supplied_session_id: sessionId,
      supplied_kind: "halfway",
      supplied_key: `gate2-nudge:${inviteId}:halfway`,
    });
  });

  it("fails closed on malformed candidate data or a nonboolean claim", async () => {
    const badRead = createGate2NudgeQueue({ rpc: vi.fn().mockResolvedValue({
      data: [{ ...candidate, sentKinds: ["unknown"] }], error: null,
    }) } as unknown as SupabaseClient<Database>);
    await expect(badRead.readCandidates()).rejects.toThrow("Invalid nudge candidate");
    const badClaim = createGate2NudgeQueue({ rpc: vi.fn().mockResolvedValue({
      data: { queued: true }, error: null,
    }) } as unknown as SupabaseClient<Database>);
    await expect(badClaim.enqueue({ inviteId, sessionId, kind: "halfway",
      idempotencyKey: `gate2-nudge:${inviteId}:halfway`, title: "Halfway", body: "Continue" }))
      .rejects.toThrow("Invalid nudge claim result");
  });

  it("surfaces private read outages and reports claim outages separately", async () => {
    const readOutage = createGate2NudgeQueue({ rpc: vi.fn().mockResolvedValue({
      data: null, error: { message: "db unavailable" },
    }) } as unknown as SupabaseClient<Database>);
    await expect(readOutage.readCandidates()).rejects.toEqual({ message: "db unavailable" });
    const rpc = vi.fn().mockResolvedValueOnce({ data: [candidate], error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "db unavailable" } });
    const queue = createGate2NudgeQueue({ rpc } as unknown as SupabaseClient<Database>);
    expect(await queueDueNudges(queue, () => new Date("2026-11-24T13:00:00Z")))
      .toEqual({ considered: 1, queued: 0, unavailable: 1 });
  });
});
