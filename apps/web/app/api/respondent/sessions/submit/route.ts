import type { NextRequest } from "next/server";
import { submitInterview } from "../../../../../server/respondent/interview-write";

export function POST(request: NextRequest) {
  return submitInterview(request);
}
