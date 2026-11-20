import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import type { CookieMethodsServer } from "@supabase/ssr";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export function appOrigin(env = process.env): string | null {
  if (!env.ENVOI_APP_ORIGIN) return null;
  try {
    const url = new URL(env.ENVOI_APP_ORIGIN);
    const local = url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.origin !== env.ENVOI_APP_ORIGIN || (url.protocol !== "https:" && !local)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function sessionClient(cookies: CookieMethodsServer) {
  const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } = process.env;
  const origin = appOrigin();
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY || !origin) return null;
  return createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies,
    cookieOptions: { httpOnly: true, sameSite: "lax", secure: origin.startsWith("https:"), path: "/" },
  });
}

export function trustedClient() {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

export function requestSession(request: NextRequest) {
  const pending = new NextResponse();
  const values = new Map(request.cookies.getAll().map(({ name, value }) => [name, value]));
  const client = sessionClient({
    getAll: () => [...values].map(([name, value]) => ({ name, value })),
    setAll(cookies) {
      for (const { name, value, options } of cookies) {
        values.set(name, value);
        pending.cookies.set(name, value, options);
      }
    },
  });

  return {
    client,
    commit(response: NextResponse) {
      for (const cookie of pending.cookies.getAll()) response.cookies.set(cookie);
      return response;
    },
  };
}

export const privateHeaders = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
};
