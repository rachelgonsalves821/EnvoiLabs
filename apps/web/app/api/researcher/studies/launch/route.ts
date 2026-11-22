import type { NextRequest } from "next/server";
import { failure, input, reply } from "../../../../../server/auth/http";
import { getResearcher } from "../../../../../server/auth/identity";
import { trustedClient } from "../../../../../server/auth/supabase";
import { allowsTestLaunch, launchGate1Study } from "../../../../../server/studies/launch";

export async function POST(request: NextRequest) {
  if (!allowsTestLaunch()) return failure(404);
  const parsed = await input(request);
  if (parsed.error !== undefined) return failure(parsed.error);
  const researcher = await getResearcher();
  if (!researcher) return failure(403);
  const database = trustedClient();
  if (!database) return failure(503);
  const result = await launchGate1Study(database, researcher, parsed.body);
  return result.status === 200 ? reply(200, result.study) : failure(result.status);
}
