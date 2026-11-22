import { Card, Chip } from "@envoi-labs/ui";
import type { HomeInvite } from "../../../server/respondent/home";
import { homeCopy as copy } from "./copy";

const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export function RespondentInvites({ invites, now }: { invites: HomeInvite[] | null; now: number }) {
  return (
    <section className="respondent-studies" aria-labelledby="respondent-studies-heading">
      <div className="respondent-studies-heading">
        <h1 id="respondent-studies-heading">{copy.title}</h1>
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
                      {currency.format(invite.rewardCents / 100)}
                    </strong>
                    <span>{copy.duration(invite.lengthMinutes)}</span>
                    <span>{copy.questionCount(invite.coreQuestionCount)}</span>
                  </div>
                  <p>{invite.state === "screening" ? copy.screening : invite.whyYou ?? copy.matched}</p>
                  <p className="respondent-invite-privacy">{copy.privacy}</p>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
