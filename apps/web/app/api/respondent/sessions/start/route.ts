import type { NextRequest } from "next/server";
import { startInterview } from "../../../../../server/respondent/interview-start";

export function POST(request: NextRequest) {
  return startInterview(request);
}
