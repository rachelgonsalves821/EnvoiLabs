import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { sessionClient } from "./supabase";

async function readSession() {
  const jar = await cookies();
  const client = sessionClient({ getAll: () => jar.getAll() });
  if (!client) return null;
  const { data, error } = await client.auth.getClaims();
  if (error || !data?.claims?.sub) return null;
  return { client, userId: data.claims.sub, assurance: data.claims.aal };
}

export async function getRespondent() {
  const session = await readSession();
  if (!session) return null;
  const { data, error } = await session.client.from("respondents")
    .select("id").eq("auth_user_id", session.userId).eq("status", "active").maybeSingle();
  return !error && typeof data?.id === "string" ? { id: data.id } : null;
}

export async function requireRespondent() {
  const respondent = await getRespondent();
  if (!respondent) redirect("/r/signup");
  return respondent;
}

export async function getResearcher() {
  const session = await readSession();
  if (session?.assurance !== "aal2") return null;
  const { data, error } = await session.client.from("researchers")
    .select("id, organization_id, role").eq("auth_user_id", session.userId).maybeSingle();
  if (error || typeof data?.id !== "string" || typeof data.organization_id !== "string"
      || (data.role !== "member" && data.role !== "admin")) return null;
  return { id: data.id, organizationId: data.organization_id, role: data.role };
}

export async function requireResearcher() {
  const researcher = await getResearcher();
  if (researcher) return researcher;
  const session = await readSession();
  redirect(session?.assurance === "aal1" ? "/app/mfa" : "/app/sign-in");
}

export async function requireAdmin() {
  const researcher = await requireResearcher();
  if (researcher.role !== "admin") redirect("/app");
  return researcher;
}
