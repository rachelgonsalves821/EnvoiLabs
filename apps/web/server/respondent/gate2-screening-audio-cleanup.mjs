const bucket = "gate2-screening-audio";
const path = /^screening\/[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}\/[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i;

export async function removeExpiredGate2ScreeningAudio(client, limit = 50) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
    throw new Error("Use a bounded screening audio cleanup batch.");
  }
  const listed = await client.rpc("list_gate2_expired_screening_audio", { supplied_limit: limit });
  if (listed.error || !Array.isArray(listed.data) || listed.data.length > limit) {
    throw new Error("Screening audio cleanup could not list private objects.");
  }
  const names = listed.data.map((row) => row?.storage_path);
  if (names.some((name) => typeof name !== "string" || !path.test(name)) ||
      new Set(names).size !== names.length) {
    throw new Error("Screening audio cleanup received an invalid path.");
  }
  if (!names.length) return 0;
  const removed = await client.storage.from(bucket).remove(names);
  if (removed.error) throw new Error("Screening audio cleanup could not remove private objects.");
  return names.length;
}
