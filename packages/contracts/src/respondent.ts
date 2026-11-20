import { z } from "zod";
import { exampleDate, exampleId, text, withExample } from "./contract.js";

export const InvitePreviewSchema = withExample(z.strictObject({
  id: z.uuid(),
  title: text,
  rewardCents: z.int().nonnegative(),
  lengthMinutes: z.int().positive().max(15),
  coreQuestionCount: z.int().positive(),
  expiresAt: z.iso.datetime(),
  whyYou: text,
}), { id: exampleId, title: "Example study", rewardCents: 280, lengthMinutes: 10,
  coreQuestionCount: 7, expiresAt: exampleDate, whyYou: "Ordered delivery" });

export const InterviewProgressSchema = withExample(z.strictObject({
  sessionId: z.uuid(),
  currentQuestion: z.int().positive(),
  coreQuestionCount: z.int().positive(),
  rewardCents: z.int().nonnegative(),
}).refine(({ currentQuestion, coreQuestionCount }) => currentQuestion <= coreQuestionCount, {
  path: ["currentQuestion"],
  message: "The current question cannot exceed the question count.",
}), { sessionId: exampleId, currentQuestion: 3, coreQuestionCount: 7, rewardCents: 280 });

export type InvitePreview = z.infer<typeof InvitePreviewSchema>;
export type InterviewProgress = z.infer<typeof InterviewProgressSchema>;
