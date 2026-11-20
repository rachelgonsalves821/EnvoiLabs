import { z } from "zod";
import { cents, count, exampleDate, exampleId, id, positive, text, timestamp, withExample } from "./contract.js";

const actorType = z.enum(["respondent", "researcher", "admin", "system"]);
const respondentHash = "a".repeat(64);
const isHashedActor = ({ actor_type, actor_id }: { actor_type: string; actor_id: string }) =>
  actor_type !== "respondent" || /^[a-f0-9]{64}$/.test(actor_id);
const shared = { occurred_at: timestamp, actor_type: actorType, actor_id: text };

const studyEvent = <Name extends string, Props extends z.ZodType>(name: Name, props: Props) =>
  z.strictObject({ ...shared, event_name: z.literal(name), study_id: id, props })
    .refine(isHashedActor, { path: ["actor_id"], message: "Respondent events require a hashed actor identity." });

const respondentEvent = <Name extends string>(name: Name) =>
  z.strictObject({
    ...shared, event_name: z.literal(name), actor_type: z.literal("respondent"),
    actor_id: z.string().regex(/^[a-f0-9]{64}$/), props: z.strictObject({}),
  });

const studyProps = { occurred_at: exampleDate, study_id: exampleId, actor_type: "system" as const, actor_id: "platform" };
const respondentProps = { occurred_at: exampleDate, actor_type: "respondent" as const, actor_id: respondentHash, props: {} };

export const EventContracts = {
  "study.created": withExample(studyEvent("study.created", z.strictObject({ target_completes: positive })),
    { ...studyProps, event_name: "study.created", props: { target_completes: 20 } }),
  "payment.succeeded": withExample(studyEvent("payment.succeeded", z.strictObject({ amount_cents: cents })),
    { ...studyProps, event_name: "payment.succeeded", props: { amount_cents: 500 } }),
  "session.approved": withExample(studyEvent("session.approved", z.strictObject({ session_id: id })),
    { ...studyProps, event_name: "session.approved", props: { session_id: exampleId } }),
  "respondent.signed_up": withExample(respondentEvent("respondent.signed_up"),
    { ...respondentProps, event_name: "respondent.signed_up" }),
  "session.submitted": withExample(studyEvent("session.submitted", z.strictObject({ session_id: id })),
    { ...studyProps, event_name: "session.submitted", props: { session_id: exampleId } }),
  "invite.accepted": withExample(studyEvent("invite.accepted", z.strictObject({ invite_id: id })),
    { ...studyProps, event_name: "invite.accepted", props: { invite_id: exampleId } }),
  "quality.removed": withExample(studyEvent("quality.removed", z.strictObject({ session_id: id })),
    { ...studyProps, event_name: "quality.removed", props: { session_id: exampleId } }),
  "probe.shown": withExample(studyEvent("probe.shown", z.strictObject({ probe_id: id, latency_ms: count })),
    { ...studyProps, event_name: "probe.shown", props: { probe_id: exampleId, latency_ms: 3000 } }),
  "respondent.activated": withExample(respondentEvent("respondent.activated"),
    { ...respondentProps, event_name: "respondent.activated" }),
  "report.viewed": withExample(studyEvent("report.viewed", z.strictObject({ report_id: id })),
    { ...studyProps, event_name: "report.viewed", props: { report_id: exampleId } }),
  "waitlist.whatsapp_opted_in": withExample(respondentEvent("waitlist.whatsapp_opted_in"),
    { ...respondentProps, event_name: "waitlist.whatsapp_opted_in" }),
};

export const EventSchema = z.discriminatedUnion("event_name", [
  EventContracts["study.created"], EventContracts["payment.succeeded"], EventContracts["session.approved"],
  EventContracts["respondent.signed_up"], EventContracts["session.submitted"], EventContracts["invite.accepted"],
  EventContracts["quality.removed"], EventContracts["probe.shown"], EventContracts["respondent.activated"],
  EventContracts["report.viewed"], EventContracts["waitlist.whatsapp_opted_in"],
]).meta({ examples: Object.values(EventContracts).flatMap((contract) => contract.meta()?.examples ?? []) });

export const LlmCallSchema = withExample(z.strictObject({
  id, occurredAt: timestamp, studyId: id.nullable(), purpose: text, model: text, inputTokens: count,
  outputTokens: count, latencyMs: count, costMicros: count, ok: z.boolean(),
}), { id: exampleId, occurredAt: exampleDate, studyId: exampleId, purpose: "scoping", model: "fixture",
  inputTokens: 10, outputTokens: 20, latencyMs: 120, costMicros: 150, ok: true });

const job = {
  studyId: id, sessionId: id, answerId: id,
};

// Identifiers only. Workers look up private audio and transcript data within their service boundary.
export const AnswerUploadedSchema = withExample(z.strictObject({ ...job, audioObjectId: id }),
  { studyId: exampleId, sessionId: exampleId, answerId: exampleId, audioObjectId: exampleId });

export const ProbeReadySchema = withExample(z.strictObject({ ...job, probeId: id }),
  { studyId: exampleId, sessionId: exampleId, answerId: exampleId, probeId: exampleId });

export type AnalyticsEvent = z.infer<typeof EventSchema>;
export type EventName = AnalyticsEvent["event_name"];
export type LlmCall = z.infer<typeof LlmCallSchema>;
export type AnswerUploaded = z.infer<typeof AnswerUploadedSchema>;
export type ProbeReady = z.infer<typeof ProbeReadySchema>;
