import { createHash, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { localService } from "./support/disposable-auth";

const bucket = "gate1-interview-audio";
const bytes = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]);

test.describe("Gate 1 audio selector after Gate 2 marketplace migrations", () => {
  test.skip(process.env.ENVOI_TEST_LOCAL_SUPABASE !== "1", "Requires disposable Auth, database and private Storage.");

  test("a signed upload after an empty sweep is selected, while a confirmed upload stays protected", async () => {
    test.setTimeout(60_000);
    const db = localService();
    const account = await db.auth.admin.createUser({
      email: `gate2-audio-history-${randomUUID()}@example.test`, email_confirm: true,
    });
    expect(account.error).toBeNull();
    const userId = account.data.user?.id;
    if (!userId) throw new Error("Synthetic account was not created.");
    const fixture = await db.rpc("test_gate2_audio_history_fixture", { supplied_user_id: userId });
    expect(fixture.error).toBeNull();
    const ids = fixture.data as {
      ownerId: string; sessionId: string; questionId: string;
      liveId: string; expiredId: string;
    };
    const livePath = `${ids.sessionId}/${ids.liveId}`;
    const expiredPath = `${ids.sessionId}/${ids.expiredId}`;

    const sign = async (path: string) => {
      const signed = await db.storage.from(bucket).createSignedUploadUrl(path, { upsert: false });
      expect(signed.error).toBeNull();
      if (!signed.data?.token) throw new Error("The private signed upload token is missing.");
      return signed.data.token;
    };
    const upload = async (path: string, token: string) => {
      const put = await db.storage.from(bucket).uploadToSignedUrl(
        path, token, new Blob([bytes], { type: "audio/webm" }),
        { contentType: "audio/webm" },
      );
      expect(put.error).toBeNull();
    };
    const selected = async () => {
      const result = await db.rpc("list_gate1_expired_audio", { supplied_limit: 50 });
      expect(result.error).toBeNull();
      return (result.data as { storage_path: string }[]).map(({ storage_path }) => storage_path);
    };

    // Both signed tokens are issued while their reservations are live.
    const liveToken = await sign(livePath);
    const lateToken = await sign(expiredPath);
    await upload(livePath, liveToken);
    const confirmation = await db.rpc("confirm_gate1_voice_answer", {
      supplied_owner_id: ids.ownerId, supplied_session_id: ids.sessionId,
      supplied_question_id: ids.questionId, supplied_audio_id: ids.liveId,
      supplied_answer_id: randomUUID(), supplied_duration_ms: 1000,
      supplied_sha256: "\\x" + createHash("sha256").update(bytes).digest("hex"),
    });
    expect(confirmation.error).toBeNull();
    for (const audioId of [ids.liveId, ids.expiredId]) {
      const expired = await db.rpc("test_gate2_audio_history_expire", { supplied_audio_id: audioId });
      expect(expired.error).toBeNull();
    }
    expect(await selected()).toEqual([]);

    // A valid signed PUT can complete after the reservation has expired and
    // after the first cleanup sweep found no object.
    await upload(expiredPath, lateToken);
    expect(await selected()).toEqual([expiredPath]);
    const lateConfirmation = await db.rpc("confirm_gate1_voice_answer", {
      supplied_owner_id: ids.ownerId, supplied_session_id: ids.sessionId,
      supplied_question_id: ids.questionId, supplied_audio_id: ids.expiredId,
      supplied_answer_id: randomUUID(), supplied_duration_ms: 1000,
      supplied_sha256: "\\x" + createHash("sha256").update(bytes).digest("hex"),
    });
    expect(lateConfirmation.error?.code).toBe("23514");
    expect(await selected()).toEqual([expiredPath]);

    const removed = await db.storage.from(bucket).remove([expiredPath]);
    expect(removed.error).toBeNull();
    expect(await selected()).toEqual([]);
    const stillConfirmed = await db.storage.from(bucket).download(livePath);
    expect(stillConfirmed.error).toBeNull();
    expect(stillConfirmed.data?.size).toBe(bytes.length);
  });
});
