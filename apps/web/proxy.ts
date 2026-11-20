import { NextResponse, type NextRequest } from "next/server";
import { privateHeaders, sessionClient } from "./server/auth/supabase";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const client = sessionClient({
    getAll: () => request.cookies.getAll(),
    setAll(cookies) {
      for (const { name, value } of cookies) request.cookies.set(name, value);
      response = NextResponse.next({ request });
      for (const { name, value, options } of cookies) response.cookies.set(name, value, options);
      for (const [key, value] of Object.entries(privateHeaders)) response.headers.set(key, value);
    },
  });
  if (client) await client.auth.getClaims();
  return response;
}

export const config = {
  matcher: ["/app/:path*", "/r", "/r/signup"],
};
