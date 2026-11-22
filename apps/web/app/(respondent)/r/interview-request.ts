export async function interviewRequest(path: string, body: object, signal?: AbortSignal) {
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), 30_000);
  function abort() { controller.abort(); }
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort);
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) return { status: response.status };
    const data: unknown = await response.json();
    return { status: response.status, data };
  } catch {
    return { status: 503 };
  } finally {
    clearTimeout(deadline);
    signal?.removeEventListener("abort", abort);
  }
}
