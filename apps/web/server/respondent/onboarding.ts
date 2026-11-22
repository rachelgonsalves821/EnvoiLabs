import { ProfileResponseSchema, SaveConsentRequestSchema, SaveProfileRequestSchema } from "@envoi-labs/contracts";
import type { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { failure, input, reply } from "../auth/http";
import { requestSession, sessionClient } from "../auth/supabase";

export const previewConsentVersion = "gate1-preview-v1";

const consentPurposes = ["recording", "transcription_vendor", "retention", "researcher_access"] as const;

export async function loadOnboarding(respondentId: string) {
  const jar = await cookies();
  const client = sessionClient({ getAll: () => jar.getAll() });
  if (!client) return null;
  const [profile, ...choices] = await Promise.all([
    client.from("profile_attributes").select("key,value_json").eq("respondent_id", respondentId),
    ...consentPurposes.map((purpose) => client.from("consents").select("purpose,granted,text_version")
      .eq("respondent_id", respondentId).eq("purpose", purpose).is("study_id", null)
      .order("created_at", { ascending: false }).order("recorded_sequence", { ascending: false })
      .limit(1).maybeSingle()),
  ]);
  if (profile.error || choices.some(({ error }) => error)) return null;
  return {
    attributes: Object.fromEntries(profile.data.map(({ key, value_json }) => [key, value_json])),
    choices: Object.fromEntries(choices.flatMap(({ data }) =>
      data?.text_version === previewConsentVersion ? [[data.purpose, data.granted]] : [],
    )),
  };
}

function rpcFailure(code: string) {
  if (code === "42501") return failure(403);
  return failure(code === "22023" ? 400 : 503);
}

export async function saveProfile(request: NextRequest) {
  const parsed = await input(request);
  if (parsed.error !== undefined) return failure(parsed.error);
  const profile = SaveProfileRequestSchema.safeParse(parsed.body);
  if (!profile.success) return failure(400);
  const session = requestSession(request);
  if (!session.client) return failure(503);
  const { data: identity, error: authError } = await session.client.auth.getClaims();
  if (authError || !identity?.claims?.sub) return failure(401);
  const { data: saved, error } = await session.client.rpc("save_gate1_profile", { attributes: profile.data.attributes });
  if (error) return rpcFailure(error.code);
  if (saved !== true) return failure(503);
  const rows = await session.client.from("profile_attributes")
    .select("id,respondent_id,key,value_json,source,created_at,updated_at");
  if (rows.error) return failure(503);
  const attributes = rows.data.map(({ id, respondent_id, key, value_json, source, created_at, updated_at }) => ({
    id, respondentId: respondent_id, key, value: value_json, source,
    createdAt: new Date(created_at).toISOString(), updatedAt: new Date(updated_at).toISOString(),
  }));
  const response = ProfileResponseSchema.safeParse({ attributes });
  if (!response.success) return failure(503);
  return session.commit(reply(200, response.data));
}

export async function saveConsent(request: NextRequest) {
  const parsed = await input(request);
  if (parsed.error !== undefined) return failure(parsed.error);
  const consent = SaveConsentRequestSchema.safeParse(parsed.body);
  if (!consent.success || consent.data.studyId !== null) return failure(400);
  const session = requestSession(request);
  if (!session.client) return failure(503);
  const { data: identity, error: authError } = await session.client.auth.getClaims();
  if (authError || !identity?.claims?.sub) return failure(401);
  const { data: saved, error } = await session.client.rpc("save_gate1_consent", { decisions: consent.data.decisions });
  if (error) return rpcFailure(error.code);
  return saved === true ? session.commit(reply()) : failure(503);
}
