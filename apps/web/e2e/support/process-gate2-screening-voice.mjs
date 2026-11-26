import { createClient } from "@supabase/supabase-js";
import { createGate2ScreeningWorkerPorts, runGate2ScreeningAudioJob } from
  "../../server/respondent/gate2-screening-worker.mjs";

const audioId = process.argv[2];
const uuid = /^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
if (process.env.ENVOI_TEST_LOCAL_SUPABASE !== "1" ||
    process.env.SUPABASE_URL !== "http://127.0.0.1:54321" ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY || !uuid.test(audioId) ||
    process.argv.length !== 3) {
  throw new Error("Screening voice fixture requires one disposable audio ID.");
}
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
});
const ports = createGate2ScreeningWorkerPorts(db, { audioObjectId: audioId,
  transcriber: { async transcribe({ audio, mediaType }) {
    if (audio.length < 4 || mediaType !== "audio/webm")
      throw new Error("Synthetic recording has the wrong container.");
    return { text: "I worked as a hospital nurse three months ago.",
      provider: "synthetic", model: "fixture", latencyMs: 0, costMicros: 0 };
  } },
});
let completedAnswerId = null;
const complete = ports.complete;
ports.complete = async (...args) => {
  const result = await complete(...args);
  if (result?.status === "completed") completedAnswerId = result.answerId;
  return result;
};
if (await runGate2ScreeningAudioJob(ports) !== "completed" ||
    !uuid.test(completedAnswerId)) {
  throw new Error("Synthetic screening voice job did not complete.");
}
process.stdout.write(JSON.stringify({ status: "completed",
  answerId: completedAnswerId }) + "\n");
