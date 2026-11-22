import { StartSessionRequestSchema } from "@envoi-labs/contracts";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireRespondent } from "../../../../../server/auth/identity";
import { interviewCopy as copy } from "./copy";
import { InterviewView } from "./view";

export const metadata: Metadata = { title: copy.title };

export default async function InterviewPage({ params }: { params: Promise<{ inviteId: string }> }) {
  await requireRespondent();
  const invite = StartSessionRequestSchema.safeParse(await params);
  if (!invite.success) return notFound();
  return <InterviewView inviteId={invite.data.inviteId} />;
}
