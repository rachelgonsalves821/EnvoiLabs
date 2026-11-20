import { z } from "zod";
import {
  audioMime, cents, count, exampleDate, exampleId, exampleRow, exampleTimestamps, id, jsonObject,
  positive, row, score, text, timestamp, timestamps, withExample,
} from "./contract.js";
import { BriefSchema, CriterionSchema, exampleBrief } from "./study.js";

export const StudyStateSchema = withExample(z.enum([
  "draft", "scoping", "brief_ready", "awaiting_payment", "fielding", "fieldwork_complete",
  "analyzing", "report_ready", "closed", "paused", "cancelled",
]), "draft");
export const InviteStateSchema = withExample(z.enum([
  "matched", "screening", "invited", "accepted", "declined", "expired", "screened_out",
]), "invited");
export const SessionStateSchema = withExample(z.enum([
  "started", "in_progress", "submitted", "quality_hold", "approved", "removed", "paid", "abandoned",
]), "started");
export const PayoutStateSchema = withExample(z.enum(["pending", "ordered", "delivered", "failed"]), "pending");
export const ConsentPurposeSchema = withExample(z.enum([
  "recording", "transcription_vendor", "retention", "researcher_access", "voice_clip_sharing",
]), "recording");

const confidence = z.enum(["high", "medium", "low"]);
const study = { studyId: id };
const respondent = { respondentId: id };
const session = { sessionId: id };
const answer = { answerId: id };
const exampleStudy = { studyId: exampleId };
const exampleRespondent = { respondentId: exampleId };
const exampleSession = { sessionId: exampleId };
const exampleAnswer = { answerId: exampleId };

export const OrganizationSchema = withExample(z.strictObject({
  ...row, name: text, designPartner: z.boolean(), pricingOverrideId: id.nullable(),
}), { ...exampleRow, name: "Example research", designPartner: false, pricingOverrideId: null });

export const ResearcherSchema = withExample(z.strictObject({
  ...row, organizationId: id, role: z.enum(["member", "admin"]), termsVersion: text, termsAcceptedAt: timestamp,
}), { ...exampleRow, organizationId: exampleId, role: "member", termsVersion: "v1", termsAcceptedAt: exampleDate });

export const RespondentSchema = withExample(z.strictObject({
  ...row, status: z.enum(["active", "paused", "banned", "deleted"]), qualityLevel: count,
  ytdPayoutCents: cents, referralCode: text, whatsappWaitlistAt: timestamp.nullable(), ageAttestedAt: timestamp,
}), { ...exampleRow, status: "active", ageAttestedAt: exampleDate, qualityLevel: 0,
  ytdPayoutCents: 0, referralCode: "example", whatsappWaitlistAt: null });

// This is an opaque reference. Keep phone material and auth identities in service-only persistence.
export const RespondentPiiReferenceSchema = withExample(z.strictObject({
  ...respondent, ...timestamps,
}), { ...exampleRespondent, ...exampleTimestamps });

export const ProfileAttributeSchema = withExample(z.strictObject({
  ...row, ...respondent, key: text, value: z.json(), source: z.enum(["signup", "screener"]),
}), { ...exampleRow, ...exampleRespondent, key: "food_delivery", value: true, source: "signup" });

export const ConsentSchema = withExample(z.strictObject({
  ...row, ...respondent, studyId: id.nullable(), purpose: ConsentPurposeSchema, granted: z.boolean(), textVersion: text,
}), { ...exampleRow, ...exampleRespondent, studyId: null, purpose: "recording", granted: true, textVersion: "v1" });

export const StudySchema = withExample(z.strictObject({
  ...row, organizationId: id, title: text, state: StudyStateSchema,
  targetCompletes: positive, lengthMinutes: positive.max(15), deadlineAt: timestamp, labels: z.array(text),
}), { ...exampleRow, organizationId: exampleId, title: "Example study", state: "draft", targetCompletes: 20,
  lengthMinutes: 12, deadlineAt: exampleDate, labels: [] });

export const BriefVersionSchema = withExample(z.strictObject({
  ...row, ...study, version: positive, brief: BriefSchema, createdBy: id,
}), { ...exampleRow, ...exampleStudy, version: 1, brief: exampleBrief, createdBy: exampleId });

export const StudyCriterionSchema = withExample(CriterionSchema.extend({
  ...row, ...study, attributeKey: text, operator: text, value: z.json(),
}), { ...exampleRow, ...exampleStudy, kind: "must", text: "Orders delivery",
  attributeKey: "food_delivery", operator: "eq", value: true });

export const GuideQuestionSchema = withExample(z.strictObject({
  ...row, ...study, position: positive, text, maxProbes: count.max(2),
}), { ...exampleRow, ...exampleStudy, position: 1, text: "What did you order?", maxProbes: 2 });

export const PricingConfigSchema = withExample(z.strictObject({
  ...row, version: positive, active: z.boolean(), params: z.strictObject({
    unitPriceCents: cents, incentivePerQuestionCents: cents,
  }),
}), { ...exampleRow, version: 1, active: true, params: { unitPriceCents: 100, incentivePerQuestionCents: 40 } });

export const QuoteSchema = withExample(z.strictObject({
  ...row, ...study, pricingConfigVersion: positive, totalCents: cents, incentiveCentsPerComplete: cents,
  lineItems: z.array(z.strictObject({ label: text, amountCents: cents })),
  feasibility: z.strictObject({ expectedCompletes: count, hours: positive }),
}), { ...exampleRow, ...exampleStudy, pricingConfigVersion: 1, totalCents: 500, incentiveCentsPerComplete: 200,
  lineItems: [{ label: "Core questions", amountCents: 500 }], feasibility: { expectedCompletes: 1, hours: 24 } });

export const PaymentSchema = withExample(z.strictObject({
  ...row, ...study, status: text, amountCents: cents, refundedCents: cents,
}).refine((payment) => payment.refundedCents <= payment.amountCents, { path: ["refundedCents"] }),
{ ...exampleRow, ...exampleStudy, status: "succeeded", amountCents: 500, refundedCents: 0 });

export const InviteSchema = withExample(z.strictObject({
  ...row, ...study, ...respondent, state: InviteStateSchema, rewardCents: cents, expiresAt: timestamp, whyYou: text,
}), { ...exampleRow, ...exampleStudy, ...exampleRespondent, state: "invited",
  rewardCents: 200, expiresAt: exampleDate, whyYou: "Orders delivery" });

export const ScreenerAnswerSchema = withExample(z.strictObject({
  ...row, inviteId: id, key: text, value: z.json(),
}), { ...exampleRow, inviteId: exampleId, key: "delivery_weekly", value: true });

export const SessionSchema = withExample(z.strictObject({
  ...row, inviteId: id, state: SessionStateSchema, startedAt: timestamp, submittedAt: timestamp.nullable(),
  livenessPassed: z.boolean().nullable(),
}), { ...exampleRow, inviteId: exampleId, state: "started", startedAt: exampleDate,
  submittedAt: null, livenessPassed: null });

export const AnswerSchema = withExample(z.strictObject({
  ...row, ...session, guideQuestionId: id, probeId: id.nullable(),
  kind: z.enum(["voice", "text"]), durationMs: count.nullable(), sequence: positive,
}), { ...exampleRow, ...exampleSession, guideQuestionId: exampleId, probeId: null,
  kind: "text", durationMs: null, sequence: 1 });

export const AudioObjectSchema = withExample(z.strictObject({
  ...row, bytes: positive, mime: audioMime, deleteAfter: timestamp,
}), { ...exampleRow, bytes: 1024, mime: "audio/webm", deleteAfter: exampleDate });

export const TranscriptSchema = withExample(z.strictObject({
  ...row, ...answer, redactedText: z.string(),
}), { ...exampleRow, ...exampleAnswer, redactedText: "I ordered [PERSON] a meal." });

export const ProbeSchema = withExample(z.strictObject({
  ...row, ...answer, text, decidedAt: timestamp, shownAt: timestamp.nullable(), latencyMs: count.nullable(),
}), { ...exampleRow, ...exampleAnswer, text: "What made you pick that?", decidedAt: exampleDate,
  shownAt: null, latencyMs: null });

export const QualityScoreSchema = withExample(z.strictObject({
  ...row, ...session, score, components: z.record(z.string(), score),
  decision: z.enum(["approve", "remove", "review"]),
}), { ...exampleRow, ...exampleSession, score: 75, components: { relevance: 80 }, decision: "approve" });

export const RemovalSchema = withExample(z.strictObject({
  ...row, ...session, reason: text, replacementInviteId: id.nullable(),
}), { ...exampleRow, ...exampleSession, reason: "Unusable transcript", replacementInviteId: null });

export const PayoutSchema = withExample(z.strictObject({
  ...row, ...respondent, sessionId: id.nullable(), amountCents: cents, state: PayoutStateSchema,
}), { ...exampleRow, ...exampleRespondent, sessionId: exampleId, amountCents: 200, state: "pending" });

export const PointsEntrySchema = withExample(z.strictObject({
  ...row, ...respondent, delta: z.int(), reason: text, referenceId: id,
}), { ...exampleRow, ...exampleRespondent, delta: 20, reason: "Milestone", referenceId: exampleId });

export const ReferralSchema = withExample(z.strictObject({
  ...row, referrerId: id, refereeId: id, state: text, bonusPayoutId: id.nullable(),
}), { ...exampleRow, referrerId: exampleId, refereeId: "22222222-2222-4222-8222-222222222222",
  state: "pending", bonusPayoutId: null });

export const ReportSchema = withExample(z.strictObject({
  ...row, ...study, version: positive, state: text, summary: jsonObject,
}), { ...exampleRow, ...exampleStudy, version: 1, state: "ready", summary: { executiveAnswer: "Delivery matters." } });

export const FindingSchema = withExample(z.strictObject({
  ...row, reportId: id, position: positive, claim: text, count, total: positive, confidence,
}).refine((finding) => finding.count <= finding.total, { path: ["count"] }),
{ ...exampleRow, reportId: exampleId, position: 1, claim: "Delivery matters.", count: 10, total: 20, confidence: "medium" });

export const EvidenceQuoteSchema = withExample(z.strictObject({
  ...row, findingId: id, transcriptId: id, startChar: count, endChar: positive, text: z.string().min(1),
}).refine((quote) => quote.endChar > quote.startChar, { path: ["endChar"] }),
{ ...exampleRow, findingId: exampleId, transcriptId: exampleId, startChar: 0, endChar: 9, text: "My order." });

export const PushSubscriptionSchema = withExample(z.strictObject({
  ...row, ...respondent, platform: text,
}), { ...exampleRow, ...exampleRespondent, platform: "web" });

export const WhatsAppWaitlistSchema = withExample(z.strictObject({
  ...respondent, optedInAt: timestamp,
}), { ...exampleRespondent, optedInAt: exampleDate });

export const AuditLogSchema = withExample(z.strictObject({
  ...row, entity: text, entityId: id, fromState: text.nullable(), toState: text, at: timestamp,
}), { ...exampleRow, entity: "study", entityId: exampleId, fromState: "draft", toState: "fielding", at: exampleDate });

export type StudyState = z.infer<typeof StudyStateSchema>;
export type InviteState = z.infer<typeof InviteStateSchema>;
export type SessionState = z.infer<typeof SessionStateSchema>;
export type PayoutState = z.infer<typeof PayoutStateSchema>;
export type ConsentPurpose = z.infer<typeof ConsentPurposeSchema>;
export type Organization = z.infer<typeof OrganizationSchema>;
export type Researcher = z.infer<typeof ResearcherSchema>;
export type Respondent = z.infer<typeof RespondentSchema>;
export type RespondentPiiReference = z.infer<typeof RespondentPiiReferenceSchema>;
export type ProfileAttribute = z.infer<typeof ProfileAttributeSchema>;
export type Consent = z.infer<typeof ConsentSchema>;
export type Study = z.infer<typeof StudySchema>;
export type BriefVersion = z.infer<typeof BriefVersionSchema>;
export type StudyCriterion = z.infer<typeof StudyCriterionSchema>;
export type GuideQuestion = z.infer<typeof GuideQuestionSchema>;
export type PricingConfig = z.infer<typeof PricingConfigSchema>;
export type Quote = z.infer<typeof QuoteSchema>;
export type Payment = z.infer<typeof PaymentSchema>;
export type Invite = z.infer<typeof InviteSchema>;
export type ScreenerAnswer = z.infer<typeof ScreenerAnswerSchema>;
export type Session = z.infer<typeof SessionSchema>;
export type Answer = z.infer<typeof AnswerSchema>;
export type AudioObject = z.infer<typeof AudioObjectSchema>;
export type Transcript = z.infer<typeof TranscriptSchema>;
export type Probe = z.infer<typeof ProbeSchema>;
export type QualityScore = z.infer<typeof QualityScoreSchema>;
export type Removal = z.infer<typeof RemovalSchema>;
export type Payout = z.infer<typeof PayoutSchema>;
export type PointsEntry = z.infer<typeof PointsEntrySchema>;
export type Referral = z.infer<typeof ReferralSchema>;
export type Report = z.infer<typeof ReportSchema>;
export type Finding = z.infer<typeof FindingSchema>;
export type EvidenceQuote = z.infer<typeof EvidenceQuoteSchema>;
export type PushSubscription = z.infer<typeof PushSubscriptionSchema>;
export type WhatsAppWaitlist = z.infer<typeof WhatsAppWaitlistSchema>;
export type AuditLog = z.infer<typeof AuditLogSchema>;
