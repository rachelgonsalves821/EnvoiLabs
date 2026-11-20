type MfaAction =
  | { action: "status" | "enroll" }
  | { action: "challenge"; factorId: string }
  | { action: "verify"; factorId: string; challengeId: string; code: string };

export class AuthRequestError extends Error {
  constructor(readonly status: number) {
    super("Researcher auth request failed.");
  }
}

async function post(path: "start" | "mfa", body: object, signal?: AbortSignal) {
  const response = await fetch(`/api/researcher/auth/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    ...(signal && { signal }),
  });
  if (!response.ok) throw new AuthRequestError(response.status);
  return response;
}

export async function sendSignInLink(email: string) {
  await post("start", { email });
}

export async function mfaRequest(action: MfaAction, signal?: AbortSignal): Promise<unknown> {
  const response = await post("mfa", action, signal);
  return action.action === "verify" ? undefined : response.json();
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
