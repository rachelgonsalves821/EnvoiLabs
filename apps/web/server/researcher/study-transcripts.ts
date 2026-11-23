import {
  ResearcherTranscriptListSchema, ResearcherTranscriptListV2Schema, StudyTrackingRequestSchema,
  type ResearcherTranscriptListV2,
} from "@envoi-labs/contracts";
import type { SupabaseClient } from "@supabase/supabase-js";

async function readGroupedTranscripts(client: SupabaseClient, studyId: string) {
  const { data, error } = await client.rpc("read_gate1_researcher_transcripts", { supplied_study_id: studyId });
  if (error) return { status: error.code === "42501" ? 403 : 503 } as const;
  if (!Array.isArray(data)) return { status: 503 } as const;

  const respondents = new Map<number, ResearcherTranscriptListV2["respondents"][number]>();
  for (const { id, respondent_number, student, redacted_text } of data) {
    const transcript = { id, redactedText: redacted_text };
    const respondent = respondents.get(respondent_number);
    if (respondent) {
      if (respondent.student !== student) return { status: 503 } as const;
      respondent.transcripts.push(transcript);
    } else {
      respondents.set(respondent_number, { number: respondent_number, student, transcripts: [transcript] });
    }
  }

  const published = ResearcherTranscriptListV2Schema.safeParse({ studyId, respondents: Array.from(respondents.values()) });
  return published.success
    ? { status: 200, transcripts: published.data } as const
    : { status: 503 } as const;
}

export async function readResearcherTranscripts(client: SupabaseClient, studyId: string, grouped = false) {
  const study = StudyTrackingRequestSchema.safeParse({ studyId });
  if (!study.success) return { status: 404 } as const;
  if (grouped) return readGroupedTranscripts(client, study.data.studyId);

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
