export function normalizeUsPhone(raw: string): string | null {
  const phone = raw.trim();
  if (!/^\+?[\d ().-]+$/.test(phone)) return null;

  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length === 10 && !phone.startsWith("+")) return `+1${digits}`;
  return null;
}

type AuthRequest = { phone: string; ageAttested: true };
type AuthResult = "success" | "throttled" | "unavailable" | "rejected";

async function sendRequest(
  action: "start" | "verify",
  payload: AuthRequest & { code?: string },
): Promise<AuthResult> {
  try {
    const response = await fetch(`/api/respondent/auth/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
    });

    if (response.ok) return "success";
    if (response.status === 429) return "throttled";
    if (response.status >= 500 || response.status === 404) return "unavailable";
    return "rejected";
  } catch {
    return "unavailable";
  }
}

export const respondentAuth = {
  start: (payload: AuthRequest) => sendRequest("start", payload),
  verify: (payload: AuthRequest & { code: string }) => sendRequest("verify", payload),
};
