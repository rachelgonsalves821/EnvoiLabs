import { NextResponse, type NextRequest } from "next/server";
import { appOrigin } from "../../../../../server/auth/supabase";

const codeShape = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export async function GET(_request: NextRequest,
  { params }: { params: Promise<{ code: string }> }) {
  if (process.env.ENVOI_GATE2_REFERRAL_ENABLED !== "true")
    return new NextResponse(null, { status: 404 });
  const { code } = await params;
  const origin = appOrigin();
  if (!origin || !codeShape.test(code)) return new NextResponse(null, { status: 404 });
  const response = NextResponse.redirect(new URL("/r/signup", origin));
  response.cookies.set("gate2-ref", code, { httpOnly: true,
    secure: origin.startsWith("https:"), sameSite: "lax", path: "/r",
    maxAge: 7 * 24 * 60 * 60 });
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
