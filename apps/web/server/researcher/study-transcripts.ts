import { ResearcherTranscriptListSchema, StudyTrackingRequestSchema } from "@envoi-labs/contracts";
import type { SupabaseClient } from "@supabase/supabase-js";

export async function readResearcherTranscripts(client: SupabaseClient, studyId: string) {
  const study = StudyTrackingRequestSchema.safeParse({ studyId });
  if (!study.success) return { status: 404 } as const;

  const { data, error } = await client.from("transcripts")
    .select("id, redacted_text")
    .eq("study_id", study.data.studyId)
    .not("redacted_text", "is", null)
    .order("created_at")
    .order("id");
  if (error) return { status: error.code === "42501" ? 403 : 503 } as const;
  if (!data) return { status: 503 } as const;

  const published = ResearcherTranscriptListSchema.safeParse({
    studyId: study.data.studyId,
    transcripts: data.map(({ id, redacted_text }) => ({ id, redactedText: redacted_text })),
  });
  return published.success
    ? { status: 200, transcripts: published.data } as const
    : { status: 503 } as const;
}
