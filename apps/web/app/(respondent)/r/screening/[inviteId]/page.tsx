import { notFound } from "next/navigation";
import { getRespondent } from "../../../../../server/auth/identity";
import { ScreeningSheetView } from "./view";

export default async function ScreeningPage({ params }: {
  params: Promise<{ inviteId: string }> }) {
  if (process.env.ENVOI_GATE2_SCREENING_SHEET_ENABLED !== "true") notFound();
  const respondent = await getRespondent();
  if (!respondent) notFound();
  const { inviteId } = await params;
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(inviteId))
    notFound();
  return <ScreeningSheetView inviteId={inviteId} />;
}
