import type { NextRequest } from "next/server";
import { updateInvite } from "../../../../../server/respondent/interview-start";

export function POST(request: NextRequest) {
  return updateInvite(request, "accept");
}
