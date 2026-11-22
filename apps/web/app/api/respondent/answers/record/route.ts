import type { NextRequest } from "next/server";
import { recordAnswer } from "../../../../../server/respondent/interview-write";

export function POST(request: NextRequest) {
  return recordAnswer(request);
}
