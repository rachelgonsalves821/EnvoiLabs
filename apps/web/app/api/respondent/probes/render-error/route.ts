import type { NextRequest } from "next/server";
import { recordProbeRenderError } from "../../../../../server/respondent/probe-prompt";

export function POST(request: NextRequest) {
  return recordProbeRenderError(request);
}
