import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "../app/api/internal/gate2/offers/route";

const { dispatch, client } = vi.hoisted(() => ({
  dispatch: vi.fn(), client: { rpc: vi.fn() },
}));
vi.mock("./auth/supabase", async (original) => ({
  ...await original<typeof import("./auth/supabase")>(),
  trustedClient: () => client,
}));
vi.mock("./platform/gate2-offer-push-send", () =>
  ({ dispatchGate2MatchedOffers: dispatch }));

const secret = "synthetic-gate2-offer-job-secret-32-chars";
const request = (token?: string) => new NextRequest(
  "https://labs.example.test/api/internal/gate2/offers", {
    method: "POST",
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
function enabled() {
  vi.stubEnv("ENVOI_GATE2_OFFER_PUSH_ENABLED", "true");
  vi.stubEnv("ENVOI_GATE2_PUSH_JOB_ENABLED", "true");
  vi.stubEnv("ENVOI_GATE2_PUSH_DELIVERY_ENABLED", "true");
  vi.stubEnv("ENVOI_GATE2_PUSH_WORKER_ENABLED", "true");
  vi.stubEnv("ENVOI_GATE2_PUSH_REGISTRATION_ENABLED", "true");
  vi.stubEnv("ENVOI_GATE2_PUSH_JOB_SECRET", secret);
  vi.stubEnv("ENVOI_GATE2_VAPID_SUBJECT", "mailto:push@example.test");
  vi.stubEnv("ENVOI_GATE2_VAPID_PUBLIC_KEY", "A".repeat(65));
  vi.stubEnv("ENVOI_GATE2_VAPID_PRIVATE_KEY", "B".repeat(45));
  vi.stubEnv("ENVOI_GATE2_PUSH_ALLOWED_ORIGINS", "https://push.example.test");
  dispatch.mockResolvedValue({ queued: 1, sent: 1, failed: 0, unresolved: 0 });
}
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });

describe("default-off matched-offer push route", () => {
  it("never runs without the offer-specific switch and shared push gates", async () => {
    expect((await POST(request(secret))).status).toBe(404);
    enabled();
    vi.stubEnv("ENVOI_GATE2_PUSH_WORKER_ENABLED", "false");
    expect((await POST(request(secret))).status).toBe(404);
    expect(dispatch).not.toHaveBeenCalled();
  });
  it("rejects missing or wrong bearer before any database use", async () => {
    enabled();
    expect((await POST(request())).status).toBe(403);
    expect((await POST(request("wrong"))).status).toBe(403);
    expect(dispatch).not.toHaveBeenCalled();
  });
  it("returns only counts for an authorized synthetic dispatch", async () => {
    enabled();
    const response = await POST(request(secret));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ queued: 1, sent: 1, failed: 0 });
    expect(dispatch.mock.calls[0]?.[0]).toBe(client);
    expect(dispatch.mock.calls[0]?.[1]).toHaveProperty("send");
    dispatch.mockResolvedValueOnce({ queued: 1, sent: 0,
      failed: 0, unresolved: 1 });
    expect((await POST(request(secret))).status).toBe(503);
  });
});
