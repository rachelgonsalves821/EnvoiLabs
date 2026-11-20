import { NextResponse, type NextRequest } from "next/server";
import { appOrigin, privateHeaders } from "./supabase";

export function reply(status = 200, data: object = { ok: true }) {
  return NextResponse.json(data, { status, headers: privateHeaders });
}

export function failure(status: number) {
  return reply(status, { ok: false });
}

export async function input(request: NextRequest) {
  const origin = appOrigin();
  if (!origin) return { error: 503 } as const;
  if (request.headers.get("origin") !== origin) return { error: 403 } as const;
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json") {
    return { error: 415 } as const;
  }
  try {
    const body: unknown = await request.json();
    return body && typeof body === "object" && !Array.isArray(body)
      ? { body: body as Record<string, unknown> } as const
      : { error: 400 } as const;
  } catch {
    return { error: 400 } as const;
  }
}

export function providerFailure(error: { status?: number | undefined } | null, fallback: number) {
  if (error?.status === 429) return failure(429);
  return failure(error?.status && error.status < 500 ? fallback : 503);
}
