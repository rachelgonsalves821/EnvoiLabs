import type { NextRequest } from "next/server";
import { reserveScreeningAudio, confirmScreeningAudio } from "../../../../../../server/respondent/screening-audio";

type Context = { params: Promise<{ inviteId: string }> };
export async function POST(request: NextRequest, { params }: Context) {
  return reserveScreeningAudio(request, (await params).inviteId);
}
export async function PUT(request: NextRequest, { params }: Context) {
  return confirmScreeningAudio(request, (await params).inviteId);
}
