import { cookies } from "next/headers";
import { sessionClient } from "../auth/supabase";
import { previewConsentVersion } from "./onboarding";

const voicePurposes = ["recording", "transcription_vendor", "retention"] as const;

export async function canRecordInterview(respondentId: string, inviteId: string) {
  const jar = await cookies();
  const client = sessionClient({ getAll: () => jar.getAll() });
  if (!client) return false;
  const invite = await client.from("invites").select("study_id").eq("id", inviteId).eq("state", "accepted").maybeSingle();
  const studyId = invite.data?.study_id;
  if (invite.error || typeof studyId !== "string") return false;
  const permissions = await Promise.all(voicePurposes.map(async (purpose) => {
    const query = () => client.from("consents").select("granted,text_version")
      .eq("respondent_id", respondentId).eq("purpose", purpose)
      .order("created_at", { ascending: false }).order("recorded_sequence", { ascending: false })
      .limit(1);
    const [general, study] = await Promise.all([
      query().is("study_id", null).maybeSingle(),
      query().eq("study_id", studyId).maybeSingle(),
    ]);
    if (general.error || study.error || general.data?.granted === false || study.data?.granted === false) return false;
    const latest = study.data ?? general.data;
    return latest?.granted === true && latest.text_version === previewConsentVersion;
  }));
  return permissions.every(Boolean);
}
