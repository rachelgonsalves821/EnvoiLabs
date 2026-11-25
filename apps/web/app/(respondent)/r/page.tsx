import { Button, Card, Echo, Sheet } from "@envoi-labs/ui";
import { getRespondent } from "../../../server/auth/identity";
import { loadHomeInvites } from "../../../server/respondent/home";
import { respondentCopy as copy } from "./copy";
import { RespondentInvites } from "./invites";

export default async function RespondentHome() {
  const respondent = await getRespondent();
  if (respondent) {
    return <RespondentInvites invites={await loadHomeInvites()} now={Date.now()}
      respondentId={respondent.id} earningsEnabled={process.env.ENVOI_GATE2_EARNINGS_ENABLED === "true"}
      screeningEnabled={process.env.ENVOI_GATE2_SCREENING_SHEET_ENABLED === "true"} />;
  }

  return (
    <Card className="respondent-welcome">
      <div>
        <h1>{copy.title}</h1>
        <p>{copy.instruction}</p>
      </div>
      <div className="respondent-echo"><Echo state="idle" size={144} /></div>
      <a className="ev-button respondent-signup-link" href="/r/signup">{copy.signup}</a>
      <Sheet trigger={<Button variant="secondary">{copy.help}</Button>} title={copy.help} description={copy.helpIntro}>
        <p>{copy.helpDetail}</p>
      </Sheet>
    </Card>
  );
}
