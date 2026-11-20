type MfaAction =
  | { action: "status" | "enroll" }
  | { action: "challenge"; factorId: string }
  | { action: "verify"; factorId: string; challengeId: string; code: string };

export class AuthRequestError extends Error {
  constructor(readonly status: number) {
    super("Researcher auth request failed.");
  }
}

const requestTimeoutMs = 30_000;

async function post(path: "start" | "mfa", body: object, signal?: AbortSignal): Promise<unknown> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, requestTimeoutMs);
  try {
    const response = await fetch(`/api/researcher/auth/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) throw new AuthRequestError(response.status);
    return await response.json();
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}

function requireConfirmation(data: unknown) {
  if (!isRecord(data) || data.ok !== true) throw new Error("Missing sign-in confirmation.");
}

export async function sendSignInLink(email: string) {
  requireConfirmation(await post("start", { email }));
}

export async function mfaRequest(action: MfaAction, signal?: AbortSignal): Promise<unknown> {
  const data = await post("mfa", action, signal);
  if (action.action === "verify") {
    requireConfirmation(data);
    return;
  }
  return data;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
