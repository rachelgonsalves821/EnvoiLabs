import { redirect } from "next/navigation";
import { requireRespondent } from "../../../../../server/auth/identity";
import { loadHomeInvites } from "../../../../../server/respondent/home";
import { verifyResumeToken } from "../../../../../server/respondent/resume-link";

export default async function ResumeInterviewPage({ params }: { params: Promise<{ token: string }> }) {
  const respondent = await requireRespondent();
  const { token } = await params;
  const inviteId = verifyResumeToken(token, respondent.id);
  if (!inviteId) redirect("/r");
  const invites = await loadHomeInvites();
  if (!invites?.some((invite) => invite.id === inviteId && invite.state === "accepted" && invite.resumable)) {
    redirect("/r");
  }
  redirect(`/r/interviews/${inviteId}`);
}
