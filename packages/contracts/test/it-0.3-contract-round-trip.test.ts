import { describe, expect, it } from "vitest";
import { z } from "zod";
import * as contracts from "../src/index.js";

const publicExports: Readonly<Record<string, unknown>> = contracts;
const publicSchemas = Object.entries(publicExports).filter(
  (entry): entry is [string, z.ZodType] => entry[1] instanceof z.ZodType,
);

describe("IT-0.3 public contract round trip", () => {
  it.each(publicSchemas)("%s has wire-safe examples", (_name, schema) => {
    const examples = schema.meta()?.examples;
    if (!Array.isArray(examples) || examples.length === 0) {
      throw new Error("Every public schema must provide a fixture.");
    }
    for (const example of examples) {
      expect(schema.parse(JSON.parse(JSON.stringify(example)))).toEqual(example);
    }
  });

  it("keeps raw identifiers and transcript text outside researcher responses", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(contracts.ResearcherTranscriptListSchema.safeParse({
      studyId: id, transcripts: [{ id, redactedText: "Redacted", rawText: "Fixture name" }],
    }).success).toBe(false);
    expect(contracts.RespondentPiiReferenceSchema.safeParse({
      respondentId: id, createdAt: "2026-11-19T18:00:00.000Z",
      updatedAt: "2026-11-19T18:00:00.000Z", phoneHash: "example",
    }).success).toBe(false);
  });

  it("rejects unhashed respondent event identifiers and untyped event data", () => {
    const base = {
      event_name: "session.submitted", occurred_at: "2026-11-19T18:00:00.000Z",
      actor_type: "respondent", actor_id: "raw-id", study_id: "11111111-1111-4111-8111-111111111111",
    };
    expect(contracts.EventSchema.safeParse({ ...base, props: { session_id: base.study_id } }).success).toBe(false);
    expect(contracts.EventSchema.safeParse({
      ...base, actor_id: "a".repeat(64), props: { session_id: base.study_id, phone: "+12025550123" },
    }).success).toBe(false);
  });

  it("accepts browser audio codec MIME strings and limits insecure upload URLs to local setup", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(contracts.StartAudioUploadRequestSchema.safeParse({
      sessionId: id, guideQuestionId: id, bytes: 1000, mime: "audio/webm;codecs=opus",
    }).success).toBe(true);
    const base = { audioObjectId: id, expiresAt: "2026-11-19T18:00:00.000Z" };
    expect(contracts.StartAudioUploadResponseSchema.safeParse({
      ...base, uploadUrl: "http://127.0.0.1:54321/upload",
    }).success).toBe(true);
    expect(contracts.StartAudioUploadResponseSchema.safeParse({
      ...base, uploadUrl: "http://example.com/upload",
    }).success).toBe(false);
  });
});
