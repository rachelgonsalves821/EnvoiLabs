import { createClient } from "@supabase/supabase-js";
import { runGate1AnswerJob } from "@envoi-labs/ai";
import { FakeTranscriber } from "../../../../packages/testing/dist/fakes/ai.js";
import { createGate1DatabasePorts } from "../../server/respondent/gate1-worker.mjs";

const audioIds = process.argv.slice(2);
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const uuid = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
if (process.env.ENVOI_TEST_LOCAL_SUPABASE !== "1" || url !== "http://127.0.0.1:54321" ||
    !key || audioIds.length !== 4 || audioIds.some((id) => !uuid.test(id))) {
  throw new Error("The synthetic voice fixture requires four answers on disposable Supabase.");
}

const db = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
});
const syntheticTranscript = "Synthetic speaker at private@example.test";
for (const answerId of audioIds) {
  const transcripts = new Map();
  const ports = createGate1DatabasePorts(db, {
    answerId,
    createTranscriber: () => new FakeTranscriber(transcripts),
    policyDigest: "a".repeat(64),
    qualificationDigest: "b".repeat(64),
    redact: async (input) => input === syntheticTranscript ? "Synthetic speaker at [EMAIL]" : null,
  });
  const claim = ports.claim;
  ports.claim = async () => {
    const item = await claim();
    if (item?.kind !== "voice") throw new Error("The worker did not claim the expected browser recording.");
    transcripts.set(item.audio.sha256, syntheticTranscript);
    return item;
  };
  if (await runGate1AnswerJob(ports) !== "published") {
    throw new Error("The disposable worker did not publish the expected synthetic result.");
  }
}
process.stdout.write(`${audioIds.length}\n`);
