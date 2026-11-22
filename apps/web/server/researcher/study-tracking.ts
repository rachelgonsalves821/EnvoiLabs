import { readGate1StudyTracking } from "@envoi-labs/services/study-tracking";
import { cookies } from "next/headers";
import { sessionClient } from "../auth/supabase";

export async function readResearcherStudyTracking(studyId: string) {
  const jar = await cookies();
  const client = sessionClient({ getAll: () => jar.getAll() });
  return client ? readGate1StudyTracking(client, studyId) : { status: 503 } as const;
}
