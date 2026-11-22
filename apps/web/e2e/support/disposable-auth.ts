import { createHmac } from "node:crypto";
import { expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

export const useDefaultTemplate = process.env.ENVOI_AUTH_TEST_LINK === "pkce";

export function loopbackOrigin(value: string | undefined) {
  const url = new URL(value ?? "");
  if (url.origin !== value || url.protocol !== "http:" || url.hostname !== "127.0.0.1") {
    throw new Error("The Auth smoke test requires an explicit HTTP loopback origin.");
  }
  return url.origin;
}

export function localService() {
  const url = loopbackOrigin(process.env.SUPABASE_URL);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("The Auth smoke test requires the disposable local service role key.");
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

export function totp(secret: string, timeMs: number) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bytes = [];
  let word = 0;
  let bits = 0;
  for (const character of secret) {
    const value = alphabet.indexOf(character);
    if (value < 0) throw new Error("Unexpected authenticator key encoding.");
    word = (word << 5) | value;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((word >> bits) & 255);
    }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(timeMs / 30_000)));
  const mac = createHmac("sha1", Buffer.from(bytes)).update(counter).digest();
  const offset = mac.readUInt8(mac.length - 1) & 15;
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

export async function deliveredEmail(page: Page, email: string, origin: string, path: string, previousId?: string) {
  const mailpit = "http://127.0.0.1:54324";
  let messageId: string | undefined;
  await expect.poll(async () => {
    const response = await page.request.get(mailpit + "/api/v1/search", { params: { query: "to:" + email } });
    if (!response.ok()) throw new Error("The disposable mail server could not search messages.");
    const inbox: { messages: { ID: string }[] } = await response.json();
    messageId = inbox.messages.find(({ ID }) => ID !== previousId)?.ID;
    return Boolean(messageId);
  }, { timeout: 15_000, message: "A sign-in email should arrive for the synthetic user" }).toBe(true);

  if (!messageId) throw new Error("The local sign-in email is missing.");
  const message = await page.request.get(mailpit + "/api/v1/message/" + encodeURIComponent(messageId));
  if (!message.ok()) throw new Error("Could not open the local sign-in email.");
  const delivered: { HTML: string } = await message.json();
  const href = await page.evaluate((html) => new DOMParser().parseFromString(html, "text/html")
    .querySelector("a")?.getAttribute("href"), delivered.HTML);
  if (!href) throw new Error("The local sign-in email did not contain a link.");
  const callback = new URL(href);
  if (callback.pathname === "/auth/v1/verify") {
    const provider = loopbackOrigin(process.env.SUPABASE_URL);
    if (callback.origin !== provider || callback.pathname !== "/auth/v1/verify"
        || callback.searchParams.get("redirect_to") !== origin + path) {
      throw new Error("The default link must verify on the disposable provider and return to the app.");
    }
    const cookies = await page.context().cookies();
    expect(cookies.some(({ name, httpOnly }) => name.endsWith("-code-verifier") && httpOnly)).toBe(true);
  } else if (useDefaultTemplate || callback.origin !== origin || callback.pathname !== path) {
    throw new Error("The custom template did not point to the expected local callback.");
  }
  return { href: callback.href, id: messageId };
}

export async function deliveredCallback(page: Page, email: string, origin: string, path: string) {
  return (await deliveredEmail(page, email, origin, path)).href;
}
