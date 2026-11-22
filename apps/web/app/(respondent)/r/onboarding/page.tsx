import { Card } from "@envoi-labs/ui";
import type { Metadata } from "next";
import { requireRespondent } from "../../../../server/auth/identity";
import { loadOnboarding, previewConsentVersion } from "../../../../server/respondent/onboarding";
import { onboardingCopy as copy } from "./copy";
import { Onboarding } from "./onboarding";
import "./onboarding.css";

export const metadata: Metadata = { title: copy.pageTitle };

export default async function OnboardingPage() {
  const { id } = await requireRespondent();
  const data = await loadOnboarding(id);
  return data
    ? <Onboarding {...data} consentVersion={previewConsentVersion} />
    : <Card className="respondent-welcome"><h1>{copy.pageTitle}</h1><p role="alert">{copy.loadFailed}</p></Card>;
}
