import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "../app/(respondent)/r/sw.js/route";

const signedPath = "/r/s/11111111-1111-4111-8111-111111111111.1795555555555." + "A".repeat(43);

afterEach(() => vi.unstubAllEnvs());

describe("respondent push worker", () => {
  it("has no push or click behavior until explicitly enabled", async () => {
    const script = await GET().text();
    expect(script).toContain("addEventListener('install'");
    expect(script).not.toContain("addEventListener('push'");
    expect(script).not.toContain("addEventListener('notificationclick'");
  });

  it("uses fixed copy and opens only a signed same-origin resume path", async () => {
    vi.stubEnv("ENVOI_GATE2_PUSH_WORKER_ENABLED", "true");
    const handlers = new Map<string, (event: unknown) => void>();
    const showNotification = vi.fn().mockResolvedValue(undefined);
    const openWindow = vi.fn().mockResolvedValue(undefined);
    const script = await GET().text();
    runInNewContext(script, { self: {
      addEventListener: (name: string, handler: (event: unknown) => void) => handlers.set(name, handler),
      skipWaiting: () => Promise.resolve(),
      registration: { showNotification }, clients: { openWindow },
    } });
    const push = handlers.get("push");
    const click = handlers.get("notificationclick");
    if (!push || !click) throw new Error("Enabled worker listeners are missing.");

    const waitUntil = vi.fn();
    push({ data: { text: () => JSON.stringify({ kind: "halfway", path: "https://evil.test/" }) }, waitUntil });
    push({ data: { text: () => JSON.stringify({ kind: "halfway", path: "/r/earnings" }) }, waitUntil });
    push({ data: { text: () => JSON.stringify({ kind: "halfway", path: signedPath,
      title: "Injected title", body: "Injected answer" }) }, waitUntil });
    expect(showNotification).toHaveBeenCalledTimes(1);
    expect(showNotification).toHaveBeenCalledWith("You’re halfway through", {
      body: "Continue your study where you stopped.",
      tag: "gate2-nudge-halfway", data: { path: signedPath },
    });
    expect(waitUntil).toHaveBeenCalledTimes(1);

    const close = vi.fn();
    click({ notification: { close, data: { path: "https://evil.test/" } }, waitUntil });
    expect(openWindow).not.toHaveBeenCalled();
    click({ notification: { close, data: { path: signedPath } }, waitUntil });
    expect(openWindow).toHaveBeenCalledExactlyOnceWith(signedPath);
    expect(close).toHaveBeenCalledTimes(2);
  });
});
