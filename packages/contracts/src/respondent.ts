import { z } from "zod";

const text = z.string().trim().min(1);

export const InvitePreviewSchema = z.strictObject({
  id: z.uuid(),
  title: text,
  rewardCents: z.int().nonnegative(),
  lengthMinutes: z.int().positive().max(15),
  coreQuestionCount: z.int().positive(),
  expiresAt: z.iso.datetime(),
  whyYou: text,
});

export const InterviewProgressSchema = z.strictObject({
  sessionId: z.uuid(),
  currentQuestion: z.int().positive(),
  coreQuestionCount: z.int().positive(),
  rewardCents: z.int().nonnegative(),
}).refine(({ currentQuestion, coreQuestionCount }) => currentQuestion <= coreQuestionCount, {
  path: ["currentQuestion"],
  message: "The current question cannot exceed the question count.",
});

export type InvitePreview = z.infer<typeof InvitePreviewSchema>;
export type InterviewProgress = z.infer<typeof InterviewProgressSchema>;
