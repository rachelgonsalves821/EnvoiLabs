const uuidPattern = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(value: unknown): string | null {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  return email.length <= 254 && emailPattern.test(email) ? email : null;
}

export function emailCallbackCredential(params: URLSearchParams) {
  const token = params.get("token_hash");
  const type = params.get("type");
  const code = params.get("code");
  if (code && uuidPattern.test(code) && token === null && type === null) return { code } as const;
  if (token && token.length <= 512 && type === "email" && code === null) return { token } as const;
  return null;
}
