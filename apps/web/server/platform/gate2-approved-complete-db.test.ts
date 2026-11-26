import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../../../packages/db/src/database.generated";
import { readGate2ApprovedCompleteSnapshot } from "./gate2-approved-complete-db";

const studyId = "a9820000-0000-4000-8000-000000000001";
const quoteId = "a9820000-0000-4000-8000-000000000002";
const actorId = "90200000-0000-4000-8000-000000000001";
const sessionId = "a9820000-0000-4000-8000-000000000003";
const client = (rpc: ReturnType<typeof vi.fn>) =>
  ({ rpc } as unknown as SupabaseClient<Database>);
const valid = { studyId, quoteId, targetRespondents: 12,
  approvedCompleteCount: 1, sessionIds: [sessionId] };

describe("private reviewed-complete snapshot adapter", () => {
  it("reads the exact paid study, quote and researcher-bound session set", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: valid, error: null });
    expect(await readGate2ApprovedCompleteSnapshot(client(rpc),
      studyId, quoteId, actorId)).toEqual(valid);
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      "read_gate2_approved_complete_snapshot", {
        supplied_study_id: studyId, supplied_quote_id: quoteId,
        supplied_auth_user_id: actorId,
      });
  });
  it("treats authorization or missing paid quote as absent", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    expect(await readGate2ApprovedCompleteSnapshot(client(rpc),
      studyId, quoteId, actorId)).toBeNull();
  });
  it("rejects mismatched, duplicate or impossible sample data", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { ...valid,
      quoteId: "a9820000-0000-4000-8000-000000000099" }, error: null });
    await expect(readGate2ApprovedCompleteSnapshot(client(rpc),
      studyId, quoteId, actorId)).rejects.toThrow("Invalid approved-complete snapshot");
    rpc.mockResolvedValue({ data: { ...valid, approvedCompleteCount: 2,
      sessionIds: [sessionId, sessionId] }, error: null });
    await expect(readGate2ApprovedCompleteSnapshot(client(rpc),
      studyId, quoteId, actorId)).rejects.toThrow("Invalid approved-complete snapshot");
    rpc.mockResolvedValue({ data: { ...valid, approvedCompleteCount: 13,
      sessionIds: Array.from({ length: 13 }, (_, index) =>
        `a9820000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`) }, error: null });
    await expect(readGate2ApprovedCompleteSnapshot(client(rpc),
      studyId, quoteId, actorId)).rejects.toThrow("Invalid approved-complete snapshot");
  });
  it("fails closed on database error or invalid caller identity", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null,
      error: { code: "500", message: "outage" } });
    await expect(readGate2ApprovedCompleteSnapshot(client(rpc),
      studyId, quoteId, actorId)).rejects.toMatchObject({ code: "500" });
    await expect(readGate2ApprovedCompleteSnapshot(client(rpc),
      studyId, quoteId, "bad")).rejects.toThrow("Invalid approved-complete lookup identity");
  });
});
