import { describeMarketplaceFeasibility, type FeasibilityView } from
  "./marketplace-feasibility-view.js";

/** Read-only seam for Gate 2's disabled-by-default authenticated aggregate route. */
export async function readMarketplaceFeasibilityView(studyId: string,
  targetRespondents: number, fetcher: typeof fetch = fetch): Promise<FeasibilityView | null> {
  try {
    const response = await fetcher(`/api/researcher/studies/${encodeURIComponent(studyId)}/feasibility`, {
      cache: "no-store", credentials: "same-origin", headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 403 || response.status === 404) return null;
    if (!response.ok) return null;
    const directives = response.headers.get("cache-control")?.toLowerCase().split(",")
      .map((part) => part.trim()) ?? [];
    if (!directives.includes("private") || !directives.includes("no-store")) return null;
    return describeMarketplaceFeasibility(await response.json(), studyId, targetRespondents);
  } catch {
    return null;
  }
}
