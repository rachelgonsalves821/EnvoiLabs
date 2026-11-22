import { createHmac, timingSafeEqual } from "node:crypto";

const uuid = "[a-f\\d]{8}(?:-[a-f\\d]{4}){3}-[a-f\\d]{12}";
const uuidPattern = new RegExp(`^${uuid}$`, "i");
const tokenPattern = new RegExp(`^(${uuid})\\.(\\d{13})\\.([a-zA-Z0-9_-]{43})$`, "i");

function signature(secret: string, payload: string) {
  return createHmac("sha256", secret).update("envoi-gate1-resume-v1:").update(payload).digest("base64url");
}

export function createResumeLink(
  inviteId: string,
  respondentId: string,
  expiresAt: string,
  now = Date.now(),
  secret = process.env.SUPABASE_SERVICE_ROLE_KEY,
) {
  const deadline = Date.parse(expiresAt);
  if (!secret || !uuidPattern.test(inviteId) || !uuidPattern.test(respondentId) ||
      !Number.isSafeInteger(deadline) || deadline <= now) return null;
  const payload = `${inviteId}.${deadline}`;
  return `/r/s/${payload}.${signature(secret, `${payload}.${respondentId}`)}`;
}

export function verifyResumeToken(
  token: string,
  respondentId: string,
  now = Date.now(),
  secret = process.env.SUPABASE_SERVICE_ROLE_KEY,
) {
  const parts = tokenPattern.exec(token);
  if (!secret || !parts || !uuidPattern.test(respondentId) || Number(parts[2]) <= now) return null;
  const payload = `${parts[1]}.${parts[2]}.${respondentId}`;
  const expected = signature(secret, payload);
  return timingSafeEqual(Buffer.from(parts[3]!), Buffer.from(expected)) ? parts[1]! : null;
}
