import { LaunchGate1StudyRequestSchema, StudyMutationResponseSchema } from "@envoi-labs/contracts";
import { appOrigin } from "../auth/supabase";

type ResearcherScope = { id: string; organizationId: string };
type LaunchDatabase = {
  rpc(name: "launch_gate1_study", args: {
    supplied_researcher_id: string;
    supplied_organization_id: string;
    supplied_study_id: string;
  }): PromiseLike<{ data: unknown; error: { code: string } | null }>;
};

export function allowsTestLaunch(env = process.env) {
  const origin = appOrigin(env);
  if (!origin || env.ENVOI_GATE1_TEST_LAUNCH !== "1") return false;
  if (env.VERCEL_ENV !== undefined) return env.VERCEL_ENV === "preview";
  return ["127.0.0.1", "[::1]", "localhost"].includes(new URL(origin).hostname);
}

export async function launchGate1Study(db: LaunchDatabase, researcher: ResearcherScope, input: unknown) {
  const launch = LaunchGate1StudyRequestSchema.safeParse(input);
  if (!launch.success) return { status: 400 } as const;
  const { data, error } = await db.rpc("launch_gate1_study", {
    supplied_researcher_id: researcher.id,
    supplied_organization_id: researcher.organizationId,
    supplied_study_id: launch.data.studyId,
  });
  if (error?.code === "42501") return { status: 404 } as const;
  if (error?.code === "23514" || error?.code === "P0002") return { status: 409 } as const;
  const study = StudyMutationResponseSchema.safeParse(data);
  if (error || !study.success || study.data.state !== "fielding") return { status: 503 } as const;
  return { status: 200, study: study.data } as const;
}
