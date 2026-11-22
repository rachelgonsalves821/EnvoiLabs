import { NonRetriableError } from "inngest";

type ExpiryDatabase = {
  rpc(name: "expire_gate1_interviews", args: { supplied_cutoff: string }): PromiseLike<{ data: unknown; error: unknown }>;
};

export function expirySchedulerConfig(env: NodeJS.ProcessEnv) {
  if (env.ENVOI_GATE1_EXPIRY_ENABLED !== "1" || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY?.trim()) return null;
  try {
    const database = new URL(env.SUPABASE_URL);
    if (database.origin !== env.SUPABASE_URL) return null;
    if (env.NODE_ENV === "development" && !env.VERCEL_ENV && env.INNGEST_DEV === "1"
      && database.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(database.hostname)) {
      return { isDev: true };
    }
    if ((env.VERCEL_ENV === "preview" || env.VERCEL_ENV === "production") && !env.INNGEST_DEV
      && database.protocol === "https:" && env.INNGEST_SIGNING_KEY?.trim()) {
      return { isDev: false, signingKey: env.INNGEST_SIGNING_KEY.trim() };
    }
  } catch {
    return null;
  }
  return null;
}

function validCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export async function runGate1Expiry(scheduledAt: number | undefined, database: ExpiryDatabase | null) {
  if (typeof scheduledAt !== "number" || !Number.isSafeInteger(scheduledAt) || scheduledAt < 0
    || Number.isNaN(new Date(scheduledAt).getTime())) {
    throw new NonRetriableError("Gate 1 expiry requires a valid scheduled timestamp.");
  }
  if (!database) throw new Error("Gate 1 expiry database is unavailable.");

  let data: unknown;
  try {
    const response = await database.rpc("expire_gate1_interviews", { supplied_cutoff: new Date(scheduledAt).toISOString() });
    if (!response.error) data = response.data;
  } catch {
    // Connection and database errors stay out of scheduler logs.
  }
  if (!data || typeof data !== "object" || !("expiredInvites" in data) || !("abandonedSessions" in data)
    || !validCount(data.expiredInvites) || !validCount(data.abandonedSessions)) {
    throw new Error("Gate 1 expiry database operation failed.");
  }
  return { expiredInvites: data.expiredInvites, abandonedSessions: data.abandonedSessions };
}
