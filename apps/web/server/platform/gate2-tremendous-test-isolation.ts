type PreviewEnvironment = {
  VERCEL_ENV?: string | undefined;
  SUPABASE_URL?: string | undefined;
  ENVOI_GATE5_ISOLATED_DATABASE_URL?: string | undefined;
  ENVOI_GATE5_PRODUCTION_DATABASE_URL?: string | undefined;
  ENVOI_GATE5_PREVIEW_PROJECT_REF?: string | undefined;
  ENVOI_GATE5_PRODUCTION_PROJECT_REF?: string | undefined;
  ENVOI_GATE5_ISOLATION_APPROVED?: string | undefined;
};

function projectRef(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port ||
      url.pathname !== "/" || url.search || url.hash ||
      url.origin !== value.replace(/\/$/, "")) return null;
    return /^([a-z0-9-]{8,})\.supabase\.co$/.exec(url.hostname)?.[1] ?? null;
  } catch { return null; }
}

// This provider callback may observe a TEST order only in the same isolated
// preview database that issued the frozen fictional payout intent.
export function isolatedTremendousTestWebhookEnvironment(
  env: PreviewEnvironment,
): boolean {
  if (env.VERCEL_ENV !== "preview" ||
    env.ENVOI_GATE5_ISOLATION_APPROVED !== "true") return false;
  const actual = projectRef(env.SUPABASE_URL);
  const preview = projectRef(env.ENVOI_GATE5_ISOLATED_DATABASE_URL);
  const production = projectRef(env.ENVOI_GATE5_PRODUCTION_DATABASE_URL);
  return !!actual && actual === preview && !!production && actual !== production &&
    env.ENVOI_GATE5_PREVIEW_PROJECT_REF === actual &&
    env.ENVOI_GATE5_PRODUCTION_PROJECT_REF === production;
}
