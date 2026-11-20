import { z } from "zod";
import { audioMime, count, exampleId, id, positive, text, timestamp, withExample } from "./contract.js";
import { AnswerSchema, ConsentPurposeSchema, InviteStateSchema, ProfileAttributeSchema, StudyStateSchema } from "./entities.js";
import { InterviewProgressSchema, InvitePreviewSchema } from "./respondent.js";
import { CriterionSchema } from "./study.js";

const phone = z.e164().regex(/^\+1\d{10}$/);
const samplePhone = "+12025550123";
const code = z.string().regex(/^\d{6}$/);
const exampleCode = "123456";
const inviteId = { inviteId: id };
const sessionId = { sessionId: id };
const studyId = { studyId: id };
const questionId = { guideQuestionId: id };
const exampleSession = { sessionId: exampleId };
const exampleStudy = { studyId: exampleId };
const exampleQuestion = { guideQuestionId: exampleId };
const resumeToken = z.string().min(32).max(512);

export const PhoneOtpStartRequestSchema = withExample(z.strictObject({
  phone, ageAttested: z.literal(true),
}), { phone: samplePhone, ageAttested: true });

export const PhoneOtpVerifyRequestSchema = withExample(PhoneOtpStartRequestSchema.extend({
  code,
}), { phone: samplePhone, ageAttested: true, code: exampleCode });

export const ResearcherMagicLinkRequestSchema = withExample(z.strictObject({
  email: z.email(),
}), { email: "researcher@example.com" });

export const ResearcherMagicLinkCallbackSchema = withExample(z.strictObject({
  token_hash: text, type: z.enum(["email", "magiclink"]),
}), { token_hash: "example-token", type: "email" });

export const ResearcherMfaRequestSchema = withExample(z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("status") }),
  z.strictObject({ action: z.literal("enroll") }),
  z.strictObject({ action: z.literal("challenge"), factorId: id }),
  z.strictObject({ action: z.literal("verify"), factorId: id, challengeId: id, code }),
]), { action: "verify", factorId: exampleId, challengeId: exampleId, code: exampleCode });

export const AuthRequestAcceptedSchema = withExample(z.strictObject({ ok: z.literal(true) }), { ok: true });

export const ResearcherMfaStatusResponseSchema = withExample(z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("verified") }),
  z.strictObject({ state: z.literal("enroll") }),
  z.strictObject({ state: z.literal("challenge"), factorId: id }),
]), { state: "challenge", factorId: exampleId });

export const ResearcherMfaEnrollResponseSchema = withExample(z.strictObject({
  factorId: id, secret: text,
}), { factorId: exampleId, secret: "JBSWY3DPEHPK3PXP" });

export const ResearcherMfaChallengeResponseSchema = withExample(z.strictObject({
  challengeId: id,
}), { challengeId: exampleId });

export const ApiErrorSchema = withExample(z.strictObject({
  code: z.enum(["invalid_request", "unauthenticated", "forbidden", "not_found", "conflict",
    "expired", "rate_limited", "unavailable"]),
}), { code: "invalid_request" });

export const SaveProfileRequestSchema = withExample(z.strictObject({
  attributes: z.array(z.strictObject({ key: text, value: z.json() })).min(1).max(8),
}), { attributes: [{ key: "food_delivery", value: true }] });

export const ProfileResponseSchema = withExample(z.strictObject({
  attributes: z.array(ProfileAttributeSchema),
}), { attributes: [] });

export const SaveConsentRequestSchema = withExample(z.strictObject({
  studyId: id.nullable(),
  decisions: z.array(z.strictObject({
    purpose: ConsentPurposeSchema, granted: z.boolean(), textVersion: text,
  })).min(1).max(5),
}).refine(({ decisions }) => new Set(decisions.map((decision) => decision.purpose)).size === decisions.length,
  { path: ["decisions"] }),
{ studyId: null, decisions: [{ purpose: "recording", granted: true, textVersion: "v1" }] });

export const InviteListResponseSchema = withExample(z.strictObject({
  invites: z.array(InvitePreviewSchema),
}), { invites: [] });

export const UpdateInviteRequestSchema = withExample(z.strictObject({
  ...inviteId, action: z.enum(["accept", "decline"]),
}), { inviteId: exampleId, action: "accept" });

export const UpdateInviteResponseSchema = withExample(z.strictObject({
  ...inviteId, state: InviteStateSchema,
}), { inviteId: exampleId, state: "accepted" });

export const StartSessionRequestSchema = withExample(z.strictObject(inviteId), { inviteId: exampleId });
export const ResumeSessionRequestSchema = withExample(z.strictObject({ token: resumeToken }),
  { token: "example-resume-token-for-tests-only" });
export const SessionResponseSchema = withExample(z.strictObject({
  ...sessionId, progress: InterviewProgressSchema, nextQuestion: z.strictObject({ id, text }).nullable(),
  expiresAt: timestamp,
}), { ...exampleSession, progress: { ...exampleSession, currentQuestion: 1, coreQuestionCount: 3, rewardCents: 0 },
  nextQuestion: { id: exampleId, text: "What did you order?" }, expiresAt: "2026-11-20T18:00:00.000Z" });

export const StartAudioUploadRequestSchema = withExample(z.strictObject({
  ...sessionId, ...questionId, bytes: positive, mime: audioMime,
}), { ...exampleSession, ...exampleQuestion, bytes: 1024, mime: "audio/webm" });

const uploadUrl = z.url().refine((value) => {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return url.protocol === "https:" ||
    (url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname));
});
export const StartAudioUploadResponseSchema = withExample(z.strictObject({
  audioObjectId: id, uploadUrl, expiresAt: timestamp,
}), { audioObjectId: exampleId, uploadUrl: "https://example.com/upload", expiresAt: "2026-11-20T18:00:00.000Z" });

const answerRequest = { ...sessionId, ...questionId, answerId: id, replaceAnswerId: id.optional() };
export const RecordAnswerRequestSchema = withExample(z.discriminatedUnion("kind", [
  z.strictObject({ ...answerRequest, kind: z.literal("text"), text }),
  z.strictObject({ ...answerRequest, kind: z.literal("voice"), audioObjectId: id, durationMs: positive }),
]), { ...exampleSession, ...exampleQuestion, answerId: exampleId, kind: "text", text: "I ordered lunch." });

export const RecordAnswerResponseSchema = withExample(z.strictObject({
  answer: AnswerSchema,
}), { answer: {
  id: exampleId, sessionId: exampleId, guideQuestionId: exampleId,
  createdAt: "2026-11-19T18:00:00.000Z", updatedAt: "2026-11-19T18:00:00.000Z",
  kind: "text", probeId: null, durationMs: null, sequence: 1,
} });

export const SubmitSessionRequestSchema = withExample(z.strictObject(sessionId), exampleSession);
export const SubmitSessionResponseSchema = withExample(z.strictObject({
  ...sessionId, state: z.literal("submitted"),
}), { ...exampleSession, state: "submitted" });

export const CreateGate1StudyRequestSchema = withExample(z.strictObject({
  title: text, targetCompletes: positive, criteria: z.array(CriterionSchema).length(2),
  coreQuestions: z.array(text).length(3),
}), { title: "Delivery study", targetCompletes: 5,
  criteria: [{ kind: "must", text: "Orders delivery" }, { kind: "exclude", text: "Works for app" }],
  coreQuestions: ["What did you order?", "What made you choose that?", "What happened next?"] });

export const LaunchGate1StudyRequestSchema = withExample(z.strictObject({
  ...studyId, skip_payment: z.literal(true),
}), { ...exampleStudy, skip_payment: true });

export const StudyMutationResponseSchema = withExample(z.strictObject({
  ...studyId, state: StudyStateSchema,
}), { ...exampleStudy, state: "draft" });

export const StudyTrackingRequestSchema = withExample(z.strictObject(studyId), exampleStudy);
export const StudyTrackingResponseSchema = withExample(z.strictObject({
  ...studyId, state: StudyStateSchema, invited: count, accepted: count, completed: count, removed: count,
  projectedFinish: timestamp.nullable(),
}), { ...exampleStudy, state: "fielding", invited: 3, accepted: 2, completed: 1, removed: 0, projectedFinish: null });

export const ResearcherTranscriptListSchema = withExample(z.strictObject({
  ...studyId, transcripts: z.array(z.strictObject({ id, redactedText: z.string() })),
}), { ...exampleStudy, transcripts: [{ id: exampleId, redactedText: "I ordered lunch." }] });

export type PhoneOtpStartRequest = z.infer<typeof PhoneOtpStartRequestSchema>;
export type PhoneOtpVerifyRequest = z.infer<typeof PhoneOtpVerifyRequestSchema>;
export type ResearcherMagicLinkRequest = z.infer<typeof ResearcherMagicLinkRequestSchema>;
export type ResearcherMagicLinkCallback = z.infer<typeof ResearcherMagicLinkCallbackSchema>;
export type ResearcherMfaRequest = z.infer<typeof ResearcherMfaRequestSchema>;
export type ResearcherMfaStatusResponse = z.infer<typeof ResearcherMfaStatusResponseSchema>;
export type ResearcherMfaEnrollResponse = z.infer<typeof ResearcherMfaEnrollResponseSchema>;
export type ResearcherMfaChallengeResponse = z.infer<typeof ResearcherMfaChallengeResponseSchema>;
export type AuthRequestAccepted = z.infer<typeof AuthRequestAcceptedSchema>;
export type ApiError = z.infer<typeof ApiErrorSchema>;
export type SaveProfileRequest = z.infer<typeof SaveProfileRequestSchema>;
export type ProfileResponse = z.infer<typeof ProfileResponseSchema>;
export type SaveConsentRequest = z.infer<typeof SaveConsentRequestSchema>;
export type InviteListResponse = z.infer<typeof InviteListResponseSchema>;
export type UpdateInviteRequest = z.infer<typeof UpdateInviteRequestSchema>;
export type UpdateInviteResponse = z.infer<typeof UpdateInviteResponseSchema>;
export type StartSessionRequest = z.infer<typeof StartSessionRequestSchema>;
export type ResumeSessionRequest = z.infer<typeof ResumeSessionRequestSchema>;
export type SessionResponse = z.infer<typeof SessionResponseSchema>;
export type StartAudioUploadRequest = z.infer<typeof StartAudioUploadRequestSchema>;
export type StartAudioUploadResponse = z.infer<typeof StartAudioUploadResponseSchema>;
export type RecordAnswerRequest = z.infer<typeof RecordAnswerRequestSchema>;
export type RecordAnswerResponse = z.infer<typeof RecordAnswerResponseSchema>;
export type SubmitSessionRequest = z.infer<typeof SubmitSessionRequestSchema>;
export type SubmitSessionResponse = z.infer<typeof SubmitSessionResponseSchema>;
export type CreateGate1StudyRequest = z.infer<typeof CreateGate1StudyRequestSchema>;
export type LaunchGate1StudyRequest = z.infer<typeof LaunchGate1StudyRequestSchema>;
export type StudyMutationResponse = z.infer<typeof StudyMutationResponseSchema>;
export type StudyTrackingRequest = z.infer<typeof StudyTrackingRequestSchema>;
export type StudyTrackingResponse = z.infer<typeof StudyTrackingResponseSchema>;
export type ResearcherTranscriptList = z.infer<typeof ResearcherTranscriptListSchema>;
