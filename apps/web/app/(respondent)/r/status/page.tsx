import type { Metadata } from "next";
import { Card } from "@envoi-labs/ui";
import { requireRespondent } from "../../../../server/auth/identity";
import { statusCopy as copy } from "./copy";

export const metadata: Metadata = { title: copy.pageTitle };

export default async function RespondentStatusPage() {
  await requireRespondent();
  return (
    <Card className="respondent-welcome">
      <div>
        <h1>{copy.title}</h1>
        <p>{copy.instruction}</p>
      </div>
      <a className="ev-button respondent-signup-link" href="/r">{copy.action}</a>
    </Card>
  );
}
