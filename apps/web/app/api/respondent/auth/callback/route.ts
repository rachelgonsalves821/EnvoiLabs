import type { NextRequest } from "next/server";
import { respondentCallback } from "../../../../../server/auth/respondent";

export function GET(request: NextRequest) {
  return respondentCallback(request);
}
