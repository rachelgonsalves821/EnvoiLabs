import type { NextRequest } from "next/server";
import { researcherStart } from "../../../../../server/auth/researcher";

export function POST(request: NextRequest) {
  return researcherStart(request);
}
