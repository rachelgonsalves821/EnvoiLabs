import { describe, expect, it, vi } from "vitest";
import { createGate2WebPushTransport } from "./gate2-web-push";

const path = `/r/s/33333333-3333-4333-8333-333333333333.1795651200000.${"a".repeat(43)}`;
const destination = { endpoint: "https://push.example.test/send",
  keys: { p256dh: "synthetic-public", auth: "synthetic-auth" } };
const config = { vapidSubject: "mailto:push@example.test",
  vapidPublicKey: "a".repeat(87), vapidPrivateKey: "b".repeat(43),
  allowedPushOrigins: ["https://push.example.test"] };

describe("Gate 2 default-off VAPID transport", () => {
  it("sends only fixed nudge kind and signed resume path with bounded delivery options", async () => {
    const sender = vi.fn().mockResolvedValue({ statusCode: 201, body: "", headers: {} });
    const transport = createGate2WebPushTransport({ ...config, sender });
    expect(await transport.send(destination, { kind: "halfway", path })).toBe("sent");
    expect(sender).toHaveBeenCalledWith(destination,
      JSON.stringify({ kind: "halfway", path }),
      expect.objectContaining({ TTL: 300, timeout: 5000,
        contentEncoding: "aes128gcm",
        vapidDetails: { subject: config.vapidSubject,
          publicKey: config.vapidPublicKey,
          privateKey: config.vapidPrivateKey } }));
    expect(await transport.send(destination, { kind: "halfway",
      path: "https://external.example.test/track" })).toBe("failed");
    expect(await transport.send({ ...destination,
      endpoint: "https://other.example.test/send" },
    { kind: "halfway", path })).toBe("failed");
    expect(sender).toHaveBeenCalledTimes(1);
  });

  it("marks definite subscription rejection failed and leaves uncertain failures unresolved", async () => {
    const sender = vi.fn().mockRejectedValueOnce({ statusCode: 410 })
      .mockRejectedValueOnce(new Error("connection lost"));
    const transport = createGate2WebPushTransport({ ...config, sender });
    expect(await transport.send(destination,
      { kind: "two_hours_left", path })).toBe("failed");
    await expect(transport.send(destination,
      { kind: "two_hours_left", path })).rejects.toThrow("connection lost");
  });

  it("sends matched offers only to the generic authenticated home path", async () => {
    const sender = vi.fn().mockResolvedValue({ statusCode: 201, body: "", headers: {} });
    const transport = createGate2WebPushTransport({ ...config, sender });
    expect(await transport.send(destination,
      { kind: "matched_offer", path: "/r" })).toBe("sent");
    expect(await transport.send(destination,
      { kind: "matched_offer", path: "/r/earnings" as "/r" })).toBe("failed");
    expect(sender).toHaveBeenCalledOnce();
    expect(sender.mock.calls[0]?.[1]).toBe(JSON.stringify({
      kind: "matched_offer", path: "/r" }));
  });

  it("requires VAPID configuration before a transport can exist", () => {
    expect(() => createGate2WebPushTransport({ ...config,
      vapidPrivateKey: "" })).toThrow("VAPID configuration unavailable");
    expect(() => createGate2WebPushTransport({ ...config,
      allowedPushOrigins: [] })).toThrow("VAPID configuration unavailable");
  });
});
