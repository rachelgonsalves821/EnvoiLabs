export function gate1InngestConfig(env: NodeJS.ProcessEnv) {
  const expiryEnabled = env.ENVOI_GATE1_EXPIRY_ENABLED === "1";
  const privateAnswersEnabled = env.ENVOI_GATE1_PRIVATE_ANSWERS_ENABLED === "1" &&
    Boolean(env.OPENAI_API_KEY?.trim() || env.GROQ_API_KEY?.trim());
  if ((!expiryEnabled && !privateAnswersEnabled) || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY?.trim()) return null;
  try {
    const database = new URL(env.SUPABASE_URL);
    if (database.origin !== env.SUPABASE_URL) return null;
    if (env.NODE_ENV === "development" && !env.VERCEL_ENV && env.INNGEST_DEV === "1"
      && database.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(database.hostname)) {
      return { client: { isDev: true }, expiryEnabled, privateAnswersEnabled };
    }
    if ((env.VERCEL_ENV === "preview" || env.VERCEL_ENV === "production") && !env.INNGEST_DEV
      && database.protocol === "https:" && env.INNGEST_SIGNING_KEY?.trim()) {
      return { client: { isDev: false, signingKey: env.INNGEST_SIGNING_KEY.trim() }, expiryEnabled, privateAnswersEnabled };
    }
  } catch {
    return null;
  }
  return null;
}
