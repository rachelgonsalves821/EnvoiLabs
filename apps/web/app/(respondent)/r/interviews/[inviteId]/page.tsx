import { StartSessionRequestSchema } from "@envoi-labs/contracts";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireRespondent } from "../../../../../server/auth/identity";
import { canRecordInterview } from "../../../../../server/respondent/voice-consent";
import { interviewCopy as copy } from "./copy";
import { InterviewView } from "./view";

export const metadata: Metadata = { title: copy.title };

export default async function InterviewPage({ params }: { params: Promise<{ inviteId: string }> }) {
  const { id: respondentId } = await requireRespondent();
  const invite = StartSessionRequestSchema.safeParse(await params);
  if (!invite.success) return notFound();
  const canRecord = await canRecordInterview(respondentId, invite.data.inviteId);
  return <InterviewView inviteId={invite.data.inviteId} canRecord={canRecord} />;
}
