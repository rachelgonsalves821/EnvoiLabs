import { sendNotification, type WebPushError } from "web-push";
import type { NudgeTransport } from "@envoi-labs/services/nudge-delivery";

const signedResumePath = /^\/r\/s\/[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}\.\d{13}\.[A-Za-z0-9_-]{43}$/i;
type Sender = typeof sendNotification;

/** Transport only. The consent-aware ledger decides whether a send is allowed. */
export function createGate2WebPushTransport(config: {
  vapidSubject: string;
  vapidPublicKey: string;
  vapidPrivateKey: string;
  allowedPushOrigins: readonly string[];
  sender?: Sender;
}): NudgeTransport {
  if (!/^(mailto:[^\s@]+@[^\s@]+|https:\/\/[^\s/]+(?:\/\S*)?)$/.test(config.vapidSubject) ||
    !/^[A-Za-z0-9_-]{60,120}$/.test(config.vapidPublicKey) ||
    !/^[A-Za-z0-9_-]{35,100}$/.test(config.vapidPrivateKey) ||
    config.allowedPushOrigins.length === 0 ||
    config.allowedPushOrigins.some((origin) => {
      try {
        const parsed = new URL(origin);
        return parsed.protocol !== "https:" || parsed.origin !== origin;
      } catch { return true; }
    }))
    throw new Error("Web Push VAPID configuration unavailable");
  const sender = config.sender ?? sendNotification;
  return {
    async send(destination, payload) {
      let endpoint: URL;
      try { endpoint = new URL(destination.endpoint); }
      catch { return "failed"; }
      if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password ||
        !config.allowedPushOrigins.includes(endpoint.origin) ||
        !destination.keys.p256dh || !destination.keys.auth ||
        !signedResumePath.test(payload.path) ||
        (payload.kind !== "halfway" && payload.kind !== "two_hours_left"))
        return "failed";
      try {
        const result = await sender(destination, JSON.stringify(payload), {
          vapidDetails: { subject: config.vapidSubject,
            publicKey: config.vapidPublicKey,
            privateKey: config.vapidPrivateKey },
          TTL: 300, timeout: 5000, urgency: "normal",
          contentEncoding: "aes128gcm",
        });
        if (result.statusCode >= 200 && result.statusCode < 300) return "sent";
        if (result.statusCode >= 400 && result.statusCode < 500 &&
          result.statusCode !== 408 && result.statusCode !== 429) return "failed";
        throw new Error("Web Push delivery result uncertain");
      } catch (error) {
        const code = (error as Partial<WebPushError>)?.statusCode;
        if (typeof code === "number" && code >= 400 && code < 500 &&
          code !== 408 && code !== 429) return "failed";
        throw error;
      }
    },
  };
}
