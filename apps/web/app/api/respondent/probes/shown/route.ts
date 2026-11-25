import type { NextRequest } from "next/server";
import { markProbeShown } from "../../../../../server/respondent/probe-prompt";

export function POST(request: NextRequest) {
  return markProbeShown(request);
}
