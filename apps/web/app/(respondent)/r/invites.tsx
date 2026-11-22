import { Card, Chip } from "@envoi-labs/ui";
import type { HomeInvite } from "../../../server/respondent/home";
import { createResumeLink } from "../../../server/respondent/resume-link";
import { homeCopy as copy } from "./copy";
import { InviteActions } from "./invite-actions";
import { formatReward } from "./reward";

export function RespondentInvites({ invites, now, respondentId }: {
  invites: HomeInvite[] | null; now: number; respondentId: string;
}) {
  const firstOffer = invites?.find(({ state }) => state === "invited")?.id;
  return (
    <section className="respondent-studies" aria-labelledby="respondent-studies-heading">
      <div className="respondent-studies-heading">
        <h1 id="respondent-studies-heading" tabIndex={-1}>{copy.title}</h1>
        <a className="ev-button respondent-signup-link" href="/r/onboarding" data-variant="secondary">{copy.profile}</a>
      </div>
      {invites === null && <p role="alert">{copy.loadError}</p>}
      {invites?.length === 0 && (
        <Card className="respondent-invite">
          <h2>{copy.emptyTitle}</h2>
          <p>{copy.emptyDescription}</p>
        </Card>
      )}
      {invites && invites.length > 0 && (
        <ul className="respondent-invite-list">
          {invites.map((invite) => {
            const minutesLeft = Math.max(1, Math.ceil((Date.parse(invite.expiresAt) - now) / 60_000));
            const status = invite.state === "screening" ? copy.screeningBadge
              : invite.state === "accepted" ? (invite.resumable ? copy.progressBadge : copy.acceptedBadge) : null;
            const resumeLink = invite.state === "accepted" && invite.resumable
              ? createResumeLink(invite.id, respondentId, invite.expiresAt, now) : null;
            return (
              <li key={invite.id}>
                <Card className="respondent-invite">
                  <div className="respondent-invite-chips">
                    <Chip tone={minutesLeft <= 120 ? "warn" : "neutral"}>
                      <time dateTime={invite.expiresAt}>{copy.timeLeft(minutesLeft)}</time>
                    </Chip>
                    {status && <Chip tone="outline">{status}</Chip>}
                  </div>
                  <h2>{copy.topic}</h2>
                  <div className="respondent-invite-facts">
                    <strong className="respondent-invite-reward">
                      <span className="ev-sr-only">{copy.rewardLabel} </span>
                      {formatReward(invite.rewardCents)}
                    </strong>
                    <span>{copy.duration(invite.lengthMinutes)}</span>
                    <span>{copy.questionCount(invite.coreQuestionCount)}</span>
                  </div>
                  <p>{invite.state === "screening" ? copy.screening : invite.whyYou ?? copy.matched}</p>
                  <p className="respondent-invite-privacy">{copy.privacy}</p>
                  {invite.state === "invited" && <InviteActions inviteId={invite.id} primary={invite.id === firstOffer} />}
                  {invite.state === "accepted" && (
                    <a className="ev-button respondent-signup-link" href={resumeLink ?? `/r/interviews/${invite.id}`} data-variant="secondary">
                      {invite.resumable ? copy.continue : copy.start}
                    </a>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
