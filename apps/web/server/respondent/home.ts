import { InvitePreviewSchema } from "@envoi-labs/contracts";
import { cookies } from "next/headers";
import { sessionClient } from "../auth/supabase";

const homeInviteSchema = InvitePreviewSchema.omit({ title: true }).extend({
  whyYou: InvitePreviewSchema.shape.whyYou.nullable(),
});

function parseInvite(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const { state, resumable, expiresAt, ...invite } = input as Record<string, unknown>;
  if ((state !== "invited" && state !== "screening" && state !== "accepted") ||
    typeof resumable !== "boolean" || typeof expiresAt !== "string") return null;
  const deadline = new Date(expiresAt);
  if (!Number.isFinite(deadline.getTime())) return null;
  const parsed = homeInviteSchema.safeParse({ ...invite, expiresAt: deadline.toISOString() });
  return parsed.success ? { ...parsed.data, state, resumable } : null;
}

export type HomeInvite = NonNullable<ReturnType<typeof parseInvite>>;

export async function loadHomeInvites() {
  const jar = await cookies();
  const client = sessionClient({ getAll: () => jar.getAll() });
  if (!client) return null;
  const { data, error } = await client.rpc("list_gate1_home_invites");
  if (error || !Array.isArray(data)) return null;
  const invites: HomeInvite[] = [];
  for (const row of data) {
    const invite = parseInvite(row);
    if (!invite) return null;
    invites.push(invite);
  }
  return invites;
}
