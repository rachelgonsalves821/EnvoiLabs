import type { NextRequest } from "next/server";
import { startAudioUpload } from "../../../../../server/respondent/private-audio";

export function POST(request: NextRequest) {
  return startAudioUpload(request);
}
