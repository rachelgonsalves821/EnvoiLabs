import { MarketplaceFeasibilitySchema } from "@envoi-labs/contracts";

export type FeasibilityRpc = (name: "read_gate2_marketplace_feasibility",
  args: { supplied_study_id: string; supplied_auth_user_id: string }) =>
  PromiseLike<{ data: unknown; error: { code: string } | null }>;

export async function readMarketplaceFeasibility(
  call: FeasibilityRpc, studyId: string, authUserId: string,
) {
  try {
    const { data, error } = await call("read_gate2_marketplace_feasibility", {
      supplied_study_id: studyId, supplied_auth_user_id: authUserId,
    });
    if (error?.code === "42501") return { status: 404 } as const;
    if (error) return { status: 503 } as const;
    const parsed = MarketplaceFeasibilitySchema.safeParse(data);
    if (!parsed.success || parsed.data.studyId !== studyId) return { status: 503 } as const;
    return { status: 200, feasibility: parsed.data } as const;
  } catch {
    return { status: 503 } as const;
  }
}
