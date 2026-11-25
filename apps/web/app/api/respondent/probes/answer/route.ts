import type { NextRequest } from "next/server";
import { recordProbeTextAnswer } from "../../../../../server/respondent/probe-prompt";

export function POST(request: NextRequest) {
  return recordProbeTextAnswer(request);
}
