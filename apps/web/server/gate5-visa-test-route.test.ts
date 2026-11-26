import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "../app/api/internal/gate5/visa-test/route";

const { issue, client } = vi.hoisted(() => ({ issue: vi.fn(), client: { rpc: vi.fn() } }));
vi.mock("./auth/supabase", async (original) => ({
  ...await original<typeof import("./auth/supabase")>(), trustedClient: () => client,
}));
vi.mock("./platform/gate2-visa-batch-issue", () =>
  ({ issueGate2SandboxVisaBatch: issue }));

const secret = "synthetic-gate5-visa-test-secret-32-chars";
const respondentId = "11111111-1111-4111-8111-111111111111";
const requestId = "22222222-2222-4222-8222-222222222222";
function request(token = secret, body: unknown = { respondentId, requestId }) {
  return new NextRequest("https://preview.example.test/api/internal/gate5/visa-test", {
    method: "POST", headers: { authorization: `Bearer ${token}`,
      "content-type": "application/json" }, body: JSON.stringify(body),
  });
}
function enabled() {
  vi.stubEnv("ENVOI_GATE5_VISA_TEST_ENABLED", "true");
  vi.stubEnv("ENVOI_GATE5_VISA_TEST_SECRET", secret);
  vi.stubEnv("TREMENDOUS_TEST_API_KEY", "TEST_fixture");
  vi.stubEnv("SUPABASE_URL", "https://isolated.example.test");
  vi.stubEnv("ENVOI_GATE5_ISOLATED_DATABASE_URL", "https://isolated.example.test");
  vi.stubEnv("VERCEL_ENV", "preview");
  issue.mockResolvedValue("ordered");
}
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });

describe("default-off TEST Visa invocation", () => {
  it("does nothing when disabled or attached to production", async () => {
    expect((await POST(request())).status).toBe(404);
    enabled();
    vi.stubEnv("VERCEL_ENV", "production");
    expect((await POST(request())).status).toBe(404);
    expect(issue).not.toHaveBeenCalled();
  });
  it("requires TEST key, exact isolated database and bearer before any reservation", async () => {
    enabled();
    vi.stubEnv("TREMENDOUS_TEST_API_KEY", "LIVE_fixture");
    expect((await POST(request())).status).toBe(503);
    vi.stubEnv("TREMENDOUS_TEST_API_KEY", "TEST_fixture");
    vi.stubEnv("ENVOI_GATE5_ISOLATED_DATABASE_URL", "https://other.example.test");
    expect((await POST(request())).status).toBe(503);
    vi.stubEnv("ENVOI_GATE5_ISOLATED_DATABASE_URL", "https://isolated.example.test");
    expect((await POST(request("wrong"))).status).toBe(403);
    expect(issue).not.toHaveBeenCalled();
  });
  it("accepts only two UUIDs and invokes one TEST batch", async () => {
    enabled();
    expect((await POST(request(secret, { respondentId, requestId, extra: true }))).status)
      .toBe(400);
    expect((await POST(request(secret, { respondentId: "bad", requestId }))).status)
      .toBe(400);
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ordered",
      mode: "tremendous_test_sandbox" });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(issue).toHaveBeenCalledExactlyOnceWith({ client,
      apiKey: "TEST_fixture", respondentId, requestId, annualCapCents: 200000 });
  });
});
