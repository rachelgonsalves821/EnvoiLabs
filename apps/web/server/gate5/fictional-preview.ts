export function fictionalWalkthroughEnabled(
  env: Record<string, string | undefined> = process.env) {
  if (env.ENVOI_GATE5_FICTIONAL_WALKTHROUGH !== "true") return false;
  if (env.VERCEL_ENV === "preview")
    return env.ENVOI_GATE5_ISOLATION_APPROVED === "true";
  return !env.VERCEL_ENV && env.ENVOI_TEST_LOCAL_SUPABASE === "1" &&
    env.SUPABASE_URL === "http://127.0.0.1:54321";
}

export function fictionalMoneyLabelsEnabled(
  env: Record<string, string | undefined> = process.env) {
  if (fictionalWalkthroughEnabled(env)) return true;
  return !env.VERCEL_ENV && env.ENVOI_TEST_LOCAL_SUPABASE === "1" &&
    env.SUPABASE_URL === "http://127.0.0.1:54321";
}

export function previewFictionalMoneyWithheld(
  env: Record<string, string | undefined> = process.env) {
  return env.VERCEL_ENV === "preview" && !fictionalWalkthroughEnabled(env);
}
