import {
  CreateGate1StudyRequestSchema,
  StudyMutationResponseSchema,
  StudyTrackingRequestSchema,
  type CreateGate1StudyRequest,
} from "@envoi-labs/contracts";
import { gate1CriterionChoices } from "./study-draft-criteria";

type ResearcherScope = { id: string; organizationId: string };
type Predicate = (typeof gate1CriterionChoices)[number] & {
  kind: CreateGate1StudyRequest["criteria"][number]["kind"];
};

type DraftDatabase = {
  rpc(name: "create_gate1_study", args: {
    supplied_researcher_id: string;
    supplied_organization_id: string;
    supplied_study_id: string;
    draft: CreateGate1StudyRequest;
    predicates: Predicate[];
  }): PromiseLike<{ data: unknown; error: { code: string } | null }>;
};

export async function createGate1Study(db: DraftDatabase, researcher: ResearcherScope, requestId: string | null, input: unknown) {
  const draft = CreateGate1StudyRequestSchema.safeParse(input);
  const id = StudyTrackingRequestSchema.safeParse({ studyId: requestId });
  if (!id.success || !draft.success || draft.data.targetCompletes > 2_147_483_647) return { status: 400 } as const;
  const predicates: Predicate[] = [];
  for (const criterion of draft.data.criteria) {
    const match = gate1CriterionChoices.find((choice) => choice.text === criterion.text);
    if (!match || predicates.some(({ text }) => text === match.text)) return { status: 400 } as const;
    predicates.push({ ...match, kind: criterion.kind });
  }

  const result = await db.rpc("create_gate1_study", {
    supplied_researcher_id: researcher.id,
    supplied_organization_id: researcher.organizationId,
    supplied_study_id: id.data.studyId,
    draft: draft.data,
    predicates,
  });
  if (result.error?.code === "42501") return { status: 403 } as const;
  if (result.error?.code === "23505") return { status: 409 } as const;
  const response = StudyMutationResponseSchema.safeParse(result.data);
  if (result.error || !response.success) return { status: 503 } as const;
  return { status: 201, study: response.data } as const;
}
