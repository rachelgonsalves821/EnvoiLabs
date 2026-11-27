import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "../app/api/webhooks/tremendous-test/route";
import { isolatedTremendousTestWebhookEnvironment } from
  "./platform/gate2-tremendous-test-isolation";

const { trusted, provider, verify, resolver, reconcile } = vi.hoisted(() => ({
  trusted: vi.fn(), provider: vi.fn(), verify: vi.fn(), resolver: vi.fn(),
  reconcile: vi.fn(),
}));
vi.mock("./auth/supabase", async (original) => ({
  ...await original<typeof import("./auth/supabase")>(),
  trustedClient: trusted,
}));
vi.mock("./platform/gate2-tremendous-sandbox", () => ({
  createTremendousSandboxPayoutProvider: provider,
}));
vi.mock("./platform/gate2-tremendous-webhook", () => ({
  verifyTremendousSandboxHint: verify,
}));
vi.mock("./platform/gate2-tremendous-webhook-process", () => ({
  createTremendousSandboxOrderResolver: resolver,
  reconcileTremendousSandboxHint: reconcile,
}));

const preview = "https://fictional-preview.supabase.co";
const production = "https://fictional-production.supabase.co";
const isolated = {
  VERCEL_ENV: "preview",
  SUPABASE_URL: preview,
  ENVOI_GATE5_ISOLATED_DATABASE_URL: preview,
  ENVOI_GATE5_PRODUCTION_DATABASE_URL: production,
  ENVOI_GATE5_PREVIEW_PROJECT_REF: "fictional-preview",
  ENVOI_GATE5_PRODUCTION_PROJECT_REF: "fictional-production",
  ENVOI_GATE5_ISOLATION_APPROVED: "true",
};
const request = () => new NextRequest(
  "https://fictional-preview.example.test/api/webhooks/tremendous-test", {
    method: "POST", body: '{"fictional":"signed-event"}',
    headers: { "tremendous-webhook-signature": "sha256=fake" },
  });

function enable() {
  for (const [key, value] of Object.entries(isolated)) vi.stubEnv(key, value);
  vi.stubEnv("ENVOI_GATE2_TEST_WEBHOOK_ENABLED", "true");
  vi.stubEnv("TREMENDOUS_TEST_WEBHOOK_SECRET", "fictional-signing-secret");
  vi.stubEnv("TREMENDOUS_TEST_API_KEY", "TEST_fictional");
  trusted.mockReturnValue({});
  verify.mockReturnValue({ eventId: "fictional", kind: "ORDERS.APPROVED",
    resourceType: "orders", resourceId: "ORDERBATCH1" });
  provider.mockReturnValue({ getOrderByKey: vi.fn() });
  resolver.mockReturnValue(vi.fn());
  reconcile.mockResolvedValue("ignored");
}
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });

describe("Tremendous TEST webhook deployment boundary", () => {
  it("requires an exact distinct preview database and reviewed project refs", () => {
    expect(isolatedTremendousTestWebhookEnvironment(isolated)).toBe(true);
    for (const wrong of [
      { VERCEL_ENV: "production" }, { VERCEL_ENV: undefined },
      { ENVOI_GATE5_ISOLATION_APPROVED: undefined },
      { SUPABASE_URL: production },
      { ENVOI_GATE5_ISOLATED_DATABASE_URL: production },
      { ENVOI_GATE5_PRODUCTION_DATABASE_URL: preview },
      { ENVOI_GATE5_PREVIEW_PROJECT_REF: "wrong-preview" },
      { ENVOI_GATE5_PRODUCTION_PROJECT_REF: "wrong-production" },
      { SUPABASE_URL: "https://fictional-preview.supabase.co/path" },
      { SUPABASE_URL: "http://127.0.0.1:54321" },
    ]) expect(isolatedTremendousTestWebhookEnvironment({ ...isolated, ...wrong }))
      .toBe(false);
  });

  it("rejects default-off, production and wrong-project hints before any client or GET", async () => {
    enable();
    vi.stubEnv("ENVOI_GATE2_TEST_WEBHOOK_ENABLED", "false");
    expect((await POST(request())).status).toBe(404);
    vi.stubEnv("ENVOI_GATE2_TEST_WEBHOOK_ENABLED", "true");
    vi.stubEnv("VERCEL_ENV", "production");
    expect((await POST(request())).status).toBe(404);
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("ENVOI_GATE5_PREVIEW_PROJECT_REF", "wrong-preview");
    expect((await POST(request())).status).toBe(503);
    vi.stubEnv("ENVOI_GATE5_PREVIEW_PROJECT_REF", "fictional-preview");
    vi.stubEnv("ENVOI_GATE5_PRODUCTION_DATABASE_URL", preview);
    expect((await POST(request())).status).toBe(503);
    expect(trusted).not.toHaveBeenCalled();
    expect(provider).not.toHaveBeenCalled();
    expect(resolver).not.toHaveBeenCalled();
    expect(reconcile).not.toHaveBeenCalled();
    expect(verify).not.toHaveBeenCalled();
  });

  it("passes a signed TEST hint only after the isolated preview checks", async () => {
    enable();
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ignored" });
    expect(trusted).toHaveBeenCalledTimes(1);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(reconcile).toHaveBeenCalledTimes(1);
  });
});
