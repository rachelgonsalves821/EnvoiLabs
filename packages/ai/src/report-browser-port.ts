import type { QualifiedReportReadPort } from "./report-reader.js";

/** Future researcher endpoint must call Gate 2's newest-qualified loader per request. */
export function reportBrowserPort(fetcher: typeof fetch = fetch): QualifiedReportReadPort {
  return {
    async readCurrent(studyId) {
      const response = await fetcher(`/api/researcher/studies/${encodeURIComponent(studyId)}/report`, {
        cache: "no-store", credentials: "same-origin", redirect: "error",
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      });
      if (response.redirected) throw new Error("Current report redirect unavailable");
      if (response.status === 403 || response.status === 404) return null;
      if (!response.ok) throw new Error("Current report unavailable");
      const cacheControl = response.headers.get("cache-control")?.toLowerCase().split(",")
        .map((directive) => directive.trim()) ?? [];
      if (!cacheControl.includes("private") || !cacheControl.includes("no-store"))
        throw new Error("Current report cache policy unavailable");
      return response.json() as Promise<unknown>;
    },
  };
}
