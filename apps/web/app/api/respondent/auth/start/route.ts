import type { NextRequest } from "next/server";
import { respondentStart } from "../../../../../server/auth/respondent";

export function POST(request: NextRequest) {
  return respondentStart(request);
}
