import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "../app/api/internal/gate2/nudges/route";

const { queue, deliver, makeQueue, client } = vi.hoisted(() => ({
  queue: vi.fn(), deliver: vi.fn(), makeQueue: vi.fn(), client: { rpc: vi.fn() },
}));
vi.mock("./auth/supabase", async (original) => ({
  ...await original<typeof import("./auth/supabase")>(),
  trustedClient: () => client,
}));
vi.mock("@envoi-labs/services/nudges", async (original) => ({
  ...await original<typeof import("@envoi-labs/services/nudges")>(),
  queueDueNudges: queue,
}));
vi.mock("./platform/gate2-nudge-db", () =>
  ({ createGate2NudgeQueue: makeQueue }));
vi.mock("./platform/gate2-nudge-send", () =>
  ({ deliverGate2Nudges: deliver }));

const secret = "synthetic-gate2-nudge-job-secret-32-chars";
const request = (token?: string) => new NextRequest(
  "https://labs.example.test/api/internal/gate2/nudges", {
    method: "POST",
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
function enabled() {
  vi.stubEnv("ENVOI_GATE2_PUSH_JOB_ENABLED", "true");
  vi.stubEnv("ENVOI_GATE2_PUSH_DELIVERY_ENABLED", "true");
  vi.stubEnv("ENVOI_GATE2_PUSH_WORKER_ENABLED", "true");
  vi.stubEnv("ENVOI_GATE2_PUSH_REGISTRATION_ENABLED", "true");
  vi.stubEnv("ENVOI_GATE2_PUSH_JOB_SECRET", secret);
  vi.stubEnv("ENVOI_GATE2_VAPID_SUBJECT", "mailto:push@example.test");
  vi.stubEnv("ENVOI_GATE2_VAPID_PUBLIC_KEY", "A".repeat(65));
  vi.stubEnv("ENVOI_GATE2_VAPID_PRIVATE_KEY", "B".repeat(45));
  vi.stubEnv("ENVOI_GATE2_PUSH_ALLOWED_ORIGINS", "https://push.example.test");
  makeQueue.mockReturnValue({});
  queue.mockResolvedValue({ considered: 2, queued: 1, unavailable: 0 });
  deliver.mockResolvedValue({ prepared: 1, sent: 1, failed: 0, unresolved: 0 });
}
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });

describe("default-off Gate 2 nudge dispatch route", () => {
  it("never reads or sends when a rollout flag or job secret is missing", async () => {
    expect((await POST(request(secret))).status).toBe(404);
    enabled();
    vi.stubEnv("ENVOI_GATE2_PUSH_WORKER_ENABLED", "false");
    expect((await POST(request(secret))).status).toBe(404);
    vi.stubEnv("ENVOI_GATE2_PUSH_WORKER_ENABLED", "true");
    vi.stubEnv("ENVOI_GATE2_PUSH_JOB_SECRET", "");
    expect((await POST(request(secret))).status).toBe(503);
    expect(queue).not.toHaveBeenCalled();
    expect(deliver).not.toHaveBeenCalled();
  });
  it("rejects missing or wrong bearer before any database or push access", async () => {
    enabled();
    expect((await POST(request())).status).toBe(403);
    expect((await POST(request("wrong"))).status).toBe(403);
    expect(queue).not.toHaveBeenCalled();
    expect(deliver).not.toHaveBeenCalled();
  });
  it("requires a valid VAPID configuration and runs one authorized queue and send", async () => {
    enabled();
    vi.stubEnv("ENVOI_GATE2_VAPID_PRIVATE_KEY", "");
    expect((await POST(request(secret))).status).toBe(503);
    expect(queue).not.toHaveBeenCalled();
    vi.stubEnv("ENVOI_GATE2_VAPID_PRIVATE_KEY", "B".repeat(45));
    const response = await POST(request(secret));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ queued: 1, sent: 1, failed: 0 });
    expect(makeQueue).toHaveBeenCalledExactlyOnceWith(client);
    expect(queue).toHaveBeenCalledOnce();
    expect(deliver).toHaveBeenCalledOnce();
    expect(deliver.mock.calls[0]?.[0]).toBe(client);
    expect(deliver.mock.calls[0]?.[1]).toHaveProperty("send");
  });
  it("reports uncertain queue or send outcomes as retryable failure", async () => {
    enabled();
    queue.mockResolvedValueOnce({ considered: 2, queued: 1, unavailable: 1 });
    expect((await POST(request(secret))).status).toBe(503);
    deliver.mockResolvedValueOnce({ prepared: 1, sent: 0,
      failed: 0, unresolved: 1 });
    expect((await POST(request(secret))).status).toBe(503);
  });
});
