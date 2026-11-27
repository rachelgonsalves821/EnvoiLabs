import type { NextRequest } from "next/server";
import { recordProbeUploadClock } from "../../../../../server/respondent/probe-prompt";

export function POST(request: NextRequest) {
  return recordProbeUploadClock(request);
}
