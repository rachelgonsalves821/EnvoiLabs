const batchSize = 50;
const uuid = "[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}";
const audioPath = new RegExp(`^${uuid}/${uuid}$`);

type ExpiredAudioCleanup = {
  list(limit: number): PromiseLike<{ data: unknown; error: unknown }>;
  remove(paths: string[]): PromiseLike<{ error: unknown }>;
};

function isAudioRow(row: unknown): row is { storage_path: string } {
  return !!row && typeof row === "object" && "storage_path" in row
    && typeof row.storage_path === "string" && row.storage_path.length === 73 && audioPath.test(row.storage_path);
}

export async function runGate1OrphanAudioCleanup(cleanup: ExpiredAudioCleanup) {
  let data: unknown;
  try {
    const response = await cleanup.list(batchSize);
    if (!response.error) data = response.data;
  } catch {
    // Provider errors can contain Storage paths.
  }
  if (!Array.isArray(data) || data.length > batchSize || !data.every(isAudioRow)) {
    throw new Error("Gate 1 expired audio listing failed.");
  }

  const paths = [...new Set(data.map((row) => row.storage_path))];
  if (paths.length === 0) return { requested: 0 };

  try {
    const response = await cleanup.remove(paths);
    if (!response.error) return { requested: paths.length };
  } catch {
    // A later sweep can retry paths that still exist.
  }
  throw new Error("Gate 1 expired audio removal failed.");
}
