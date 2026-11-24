import { timingSafeEqual } from "node:crypto";
import { previewTrustedSource } from "./preview-config";

type Environment = Record<string, string | undefined>;

const syntheticSpoofs = new Set(["192.0.2.71", "198.51.100.72", "203.0.113.73"]);

function authorized(request: Request, token: string): boolean {
  const supplied = request.headers.get("authorization");
  if (!supplied?.startsWith("Bearer ")) return false;
  const actual = Buffer.from(supplied.slice(7));
  const expected = Buffer.from(token);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Temporary diagnostic. Never return or log the parsed address or request headers. */
export function observePreviewIngress(request: Request, env: Environment): Response {
  const token = env.GATE4_INGRESS_OBSERVER_TOKEN;
  if (env.VERCEL !== "1" || env.VERCEL_ENV !== "preview" ||
      !token || Buffer.byteLength(token) < 32 || !authorized(request, token)) {
    return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  const source = previewTrustedSource(request.headers, env);
  return Response.json({ sourceUsable: source !== null,
    sourceEqualsSpoof: source !== null && syntheticSpoofs.has(source) },
  { headers: { "Cache-Control": "no-store" } });
}
