import type { NextRequest } from "next/server";
import { respondentAuth } from "../../../../../server/auth/respondent";

export function POST(request: NextRequest) {
  return respondentAuth(request, false);
}
