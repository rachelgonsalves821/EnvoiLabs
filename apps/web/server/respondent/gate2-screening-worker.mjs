const bucket = "gate2-screening-audio";
const uuid = /^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
const hash = /^[a-f\d]{64}$/;
const mimes = new Set(["audio/webm", "audio/mp4", "audio/wav", "audio/ogg"]);

function validClaim(claim, requestedId) {
  if (!claim || !uuid.test(claim.audioObjectId) || !uuid.test(claim.leaseId) ||
      (requestedId && claim.audioObjectId !== requestedId) ||
      !Number.isSafeInteger(claim.bytes) || claim.bytes < 1 || claim.bytes > 20 * 1024 * 1024 ||
      !Number.isSafeInteger(claim.durationMs) || claim.durationMs < 1 || claim.durationMs > 180_000 ||
      !mimes.has(claim.mime) || !hash.test(claim.sha256)) return false;
  const path = claim.storagePath?.split("/");
  return path?.length === 3 && path[0] === "screening" && uuid.test(path[1]) &&
    path[2] === claim.audioObjectId;
}

async function matchesAudio(bytes, claim) {
  if (bytes.length !== claim.bytes) return false;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("") === claim.sha256;
}

export function createGate2ScreeningWorkerPorts(client, { audioObjectId = null, transcriber }) {
  if (audioObjectId !== null && !uuid.test(audioObjectId)) throw new Error("Invalid screening audio ID.");
  async function rpc(name, args) {
    const { data, error } = await client.rpc(name, args);
    if (error) throw new Error(`Screening audio job failed during ${name}.`);
    return data;
  }
  return {
    transcriber,
    async claim() {
      const claim = await rpc("claim_gate2_screening_audio", { supplied_audio_id: audioObjectId });
      if (claim === null) return null;
      if (!validClaim(claim, audioObjectId)) throw new Error("Invalid screening audio claim.");
      return claim;
    },
    validate: ({ audioObjectId, leaseId }) => rpc("validate_gate2_screening_audio", {
      supplied_audio_id: audioObjectId, supplied_lease_id: leaseId,
    }),
    async download(path) {
      const { data, error } = await client.storage.from(bucket).download(path);
      if (error || !data || data.size > 20 * 1024 * 1024) {
        throw new Error("Screening recording unavailable.");
      }
      return new Uint8Array(await data.arrayBuffer());
    },
    complete: ({ audioObjectId, leaseId }, transcription) =>
      rpc("complete_gate2_screening_audio", {
        supplied_audio_id: audioObjectId, supplied_lease_id: leaseId,
        supplied_text: transcription.text, supplied_provider: transcription.provider,
        supplied_model: transcription.model,
      }),
    retry: ({ audioObjectId, leaseId }) => rpc("retry_gate2_screening_audio", {
      supplied_audio_id: audioObjectId, supplied_lease_id: leaseId,
    }),
  };
}

export async function runGate2ScreeningAudioJob(ports) {
  const claim = await ports.claim();
  if (!claim) return "idle";
  const lease = { audioObjectId: claim.audioObjectId, leaseId: claim.leaseId };
  if (await ports.validate(lease) !== true) return "stale";
  let transcription;
  try {
    const bytes = await ports.download(claim.storagePath);
    if (!await matchesAudio(bytes, claim)) throw new Error("Recording hash mismatch.");
    if (await ports.validate(lease) !== true) return "stale";
    transcription = await ports.transcriber.transcribe({ audio: bytes, mediaType: claim.mime });
  } catch {
    await ports.retry(lease);
    return "retry";
  }
  if (await ports.validate(lease) !== true) return "stale";
  if (typeof transcription?.text !== "string" || !transcription.text.trim() ||
      transcription.text.length > 2000 || !transcription.provider?.trim() ||
      !transcription.model?.trim()) {
    await ports.retry(lease);
    return "retry";
  }
  const result = await ports.complete(lease, transcription);
  if (!new Set(["completed", "alreadyCompleted", "stale"]).has(result?.status)) {
    throw new Error("Invalid screening transcription completion.");
  }
  return result.status;
}
