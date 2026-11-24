import { describe, expect, it } from "vitest";
import { observePreviewIngress } from "./ingress-observer";

const token = "synthetic-preview-observer-token-at-least-32-bytes";
const preview = { VERCEL: "1", VERCEL_ENV: "preview", GATE4_INGRESS_OBSERVER_TOKEN: token };

function request(headers: Record<string, string> = {}) {
  return new Request("https://example.test/api/gate4/ingress-observer", {
    headers: { authorization: `Bearer ${token}`, ...headers },
  });
}

describe("temporary preview ingress observer", () => {
  it("is absent without preview environment, dedicated token, or valid bearer", () => {
    expect(observePreviewIngress(request(), { ...preview, VERCEL_ENV: "production" }).status).toBe(404);
    expect(observePreviewIngress(request(), { ...preview, GATE4_INGRESS_OBSERVER_TOKEN: "short" }).status).toBe(404);
    expect(observePreviewIngress(request({ authorization: "Bearer wrong" }), preview).status).toBe(404);
  });

  it("returns booleans only and never echoes an address or header", async () => {
    const response = observePreviewIngress(request({ "x-vercel-forwarded-for": "192.0.2.71",
      "x-forwarded-for": "198.51.100.72", "x-real-ip": "203.0.113.73" }), preview);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ sourceUsable: true, sourceEqualsSpoof: true });
  });

  it("rejects a comma-list as unusable", async () => {
    const response = observePreviewIngress(request({ "x-vercel-forwarded-for": "192.0.2.71, 203.0.113.73" }), preview);
    expect(await response.json()).toEqual({ sourceUsable: false, sourceEqualsSpoof: false });
  });
});
