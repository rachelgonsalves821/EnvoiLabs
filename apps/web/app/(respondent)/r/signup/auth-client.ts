type AuthRequest = { email: string; ageAttested: true };
type AuthResult = "success" | "throttled" | "unavailable" | "rejected";

const requestTimeoutMs = 30_000;

export async function requestSignInLink(payload: AuthRequest): Promise<AuthResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    const response = await fetch("/api/respondent/auth/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });

    if (response.ok) {
      const confirmation: unknown = await response.json();
      return confirmation !== null && typeof confirmation === "object" &&
        "ok" in confirmation && confirmation.ok === true ? "success" : "unavailable";
    }
    if (response.status === 429) return "throttled";
    if (response.status >= 500 || response.status === 404) return "unavailable";
    return "rejected";
  } catch {
    return "unavailable";
  } finally {
    clearTimeout(timeout);
  }
}
