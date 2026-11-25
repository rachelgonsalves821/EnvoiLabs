import type { NextRequest } from "next/server";
import { failure, input, reply } from "../../../../server/auth/http";
import { requestSession } from "../../../../server/auth/supabase";

function endpoint(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.username === "" && url.password === "" &&
      url.hash === "" && url.pathname !== "/" && url.href === value &&
      !/^\d+\.\d+\.\d+\.\d+$/.test(url.hostname) &&
      url.hostname !== "localhost" && !url.hostname.endsWith(".local");
  } catch { return false; }
}
async function owner(request: NextRequest) {
  const session = requestSession(request);
  if (!session.client) return { session, error: 503 } as const;
  const identity = await session.client.auth.getClaims();
  if (identity.error || !identity.data?.claims?.sub) return { session, error: 403 } as const;
  return { session, error: null } as const;
}

export async function POST(request: NextRequest) {
  if (process.env.ENVOI_GATE2_PUSH_REGISTRATION_ENABLED !== "true") return failure(404);
  const parsed = await input(request);
  if (parsed.error !== undefined) return failure(parsed.error);
  const { endpoint: url, p256dh, auth } = parsed.body;
  if (Object.keys(parsed.body).length !== 3 || !endpoint(url) ||
    typeof p256dh !== "string" || !/^[A-Za-z0-9_-]{80,100}={0,2}$/.test(p256dh) ||
    typeof auth !== "string" || !/^[A-Za-z0-9_-]{20,32}={0,2}$/.test(auth))
    return failure(400);
  const current = await owner(request);
  if (current.error) return current.session.commit(failure(current.error));
  const { data, error } = await current.session.client!.rpc("register_gate2_push_subscription", {
    supplied_endpoint: url, supplied_p256dh: p256dh, supplied_auth: auth,
  });
  if (error) return current.session.commit(failure(
    error.code === "23514" || error.code === "42501" ? 403 : 503));
  return current.session.commit(data === true ? reply(200) : failure(503));
}

export async function DELETE(request: NextRequest) {
  if (process.env.ENVOI_GATE2_PUSH_REGISTRATION_ENABLED !== "true") return failure(404);
  const parsed = await input(request);
  if (parsed.error !== undefined) return failure(parsed.error);
  const { endpoint: url } = parsed.body;
  if (Object.keys(parsed.body).length !== 1 || !endpoint(url)) return failure(400);
  const current = await owner(request);
  if (current.error) return current.session.commit(failure(current.error));
  const { data, error } = await current.session.client!.rpc("remove_gate2_push_subscription", {
    supplied_endpoint: url,
  });
  if (error) return current.session.commit(failure(503));
  return current.session.commit(typeof data === "boolean" ? reply(200) : failure(503));
}
