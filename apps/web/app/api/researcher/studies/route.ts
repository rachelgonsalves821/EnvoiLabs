import { createGate1Study } from "@envoi-labs/services/study-draft";
import type { NextRequest } from "next/server";
import { failure, input, reply } from "../../../../server/auth/http";
import { getResearcher } from "../../../../server/auth/identity";
import { trustedClient } from "../../../../server/auth/supabase";

export async function POST(request: NextRequest) {
  const parsed = await input(request);
  if (parsed.error !== undefined) return failure(parsed.error);
  const researcher = await getResearcher();
  if (!researcher) return failure(403);
  const database = trustedClient();
  if (!database) return failure(503);
  const result = await createGate1Study(database, researcher, request.headers.get("idempotency-key"), parsed.body);
  return result.status === 201 ? reply(201, result.study) : failure(result.status);
}
