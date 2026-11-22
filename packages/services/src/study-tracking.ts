import {
  CreateGate1StudyRequestSchema, StudyTrackingRequestSchema, StudyTrackingResponseSchema,
} from "@envoi-labs/contracts";

const trackingWithStudy = StudyTrackingResponseSchema.extend({
  title: CreateGate1StudyRequestSchema.shape.title,
  targetCompletes: CreateGate1StudyRequestSchema.shape.targetCompletes,
});

type TrackingDatabase = {
  rpc(name: "get_gate1_study_tracking", args: { supplied_study_id: string }):
    PromiseLike<{ data: unknown; error: { code: string } | null }>;
};

export async function readGate1StudyTracking(db: TrackingDatabase, studyId: string) {
  const requested = StudyTrackingRequestSchema.safeParse({ studyId });
  if (!requested.success) return { status: 404 } as const;
  const { data, error } = await db.rpc("get_gate1_study_tracking", { supplied_study_id: requested.data.studyId });
  if (error) return { status: error.code === "42501" ? 403 : 503 } as const;
  if (data === null) return { status: 404 } as const;
  const response = trackingWithStudy.safeParse(data);
  if (!response.success || response.data.studyId !== requested.data.studyId.toLowerCase()) {
    return { status: 503 } as const;
  }
  const { title, targetCompletes, ...tracking } = response.data;
  return { status: 200, title, targetCompletes, tracking } as const;
}
