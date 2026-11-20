import { createHmac, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const enabled = process.env.ENVOI_TEST_LOCAL_SUPABASE === "1";
const phone = "+12025550142";
const smsCode = "012345";

function loopbackOrigin(value: string | undefined) {
  const url = new URL(value ?? "");
  if (url.origin !== value || url.protocol !== "http:" || url.hostname !== "127.0.0.1") {
    throw new Error("The Auth smoke test requires an explicit HTTP loopback origin.");
  }
  return url.origin;
}

function localService() {
  const url = loopbackOrigin(process.env.SUPABASE_URL);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("The Auth smoke test requires the disposable local service role key.");
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

function totp(secret: string, timeMs: number) {
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

test.describe("local Auth with synthetic fixtures", () => {
  test.skip(!enabled, "Requires a disposable loopback Supabase Auth stack.");
  test.skip(({ browserName }) => browserName !== "chromium", "Uses one synthetic phone per run.");

  test("respondent verifies a fixed local OTP and captures the age attestation", async ({ page, baseURL }) => {
    loopbackOrigin(baseURL);
    const service = localService();
    await page.goto("/r/signup");
    await page.getByRole("textbox", { name: "Phone number" }).fill(phone);
    await page.getByRole("checkbox", { name: /18 or older/ }).check();
    await page.getByRole("button", { name: "Text me a code" }).click();
    await expect(page.getByRole("heading", { name: "Enter your code" })).toBeVisible();
    await page.getByRole("textbox", { name: "Verification code" }).fill(smsCode);
    await page.getByRole("button", { name: "Verify phone number" }).click();
    await expect(page.getByRole("heading", { name: "Phone verified" })).toBeVisible();

    const cookies = await page.context().cookies();
    expect(cookies.some(({ name, httpOnly }) => /^sb-.+-auth-token(?:\.\d+)?$/.test(name) && httpOnly)).toBe(true);
    const listing = await service.auth.admin.listUsers();
    expect(listing.error).toBeNull();
    const user = listing.data?.users.find(({ phone: candidate }) => candidate?.replace(/^\+/, "") === phone.slice(1));
    expect(user).toBeDefined();
    if (!user) throw new Error("Synthetic respondent was not created.");
    const row = await service.from("respondents").select("age_attested_at").eq("auth_user_id", user.id).single();
    expect(row.error).toBeNull();
    expect(row.data?.age_attested_at).toBeTruthy();
  });

  test("a local magic link needs TOTP before the researcher workspace renders", async ({ page, baseURL }) => {
    const origin = loopbackOrigin(baseURL);
    const service = localService();
    const email = `auth-smoke-${randomUUID()}@example.test`;
    const created = await service.auth.admin.createUser({ email, email_confirm: true });
    if (created.error || !created.data.user) throw new Error("Could not create the synthetic researcher.");
    const organization = await service.from("organizations").insert({ name: "Auth smoke fixture" }).select("id").single();
    if (organization.error || !organization.data) throw new Error("Could not create the synthetic organization.");
    const membership = await service.from("researchers").insert({
      auth_user_id: created.data.user.id,
      organization_id: organization.data.id,
      terms_version: "synthetic-test",
      terms_accepted_at: new Date().toISOString(),
    });
    expect(membership.error).toBeNull();

    await page.goto("/app/sign-in");
    await page.getByLabel("Email address").fill(email);
    await page.getByRole("button", { name: "Send sign-in link" }).click();
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();

    const mailpit = "http://127.0.0.1:54324";
    let messageId: string | undefined;
    await expect.poll(async () => {
      const response = await page.request.get(mailpit + "/api/v1/search", { params: { query: "to:" + email } });
      if (!response.ok()) throw new Error("The disposable mail server could not search messages.");
      const inbox: { messages: { ID: string }[] } = await response.json();
      messageId = inbox.messages[0]?.ID;
      return Boolean(messageId);
    }, { timeout: 15_000, message: "A sign-in email should arrive for the synthetic researcher" }).toBe(true);

    if (!messageId) throw new Error("The local sign-in email is missing.");
    const message = await page.request.get(mailpit + "/view/" + encodeURIComponent(messageId) + ".html");
    if (!message.ok()) throw new Error("Could not open the local sign-in email.");
    const href = await page.evaluate((html) => new DOMParser().parseFromString(html, "text/html")
      .querySelector("a")?.getAttribute("href"), await message.text());
    if (!href) throw new Error("The local sign-in email did not contain a link.");
    const callback = new URL(href);
    if (callback.origin !== origin || callback.pathname !== "/api/researcher/auth/callback") {
      throw new Error("The email link did not point to the local researcher callback.");
    }
    await page.goto(callback.href);
    await expect(page).toHaveURL(/\/app\/mfa$/);
    await page.goto("/app");
    await expect(page).toHaveURL(/\/app\/mfa$/);
    await expect(page.locator("#new-study")).toHaveCount(0);

    await page.getByRole("button", { name: "Show setup key" }).click();
    const setupKey = page.locator("main code");
    await expect(setupKey).toBeVisible();
    const secret = (await setupKey.textContent())?.trim();
    if (!secret) throw new Error("Synthetic authenticator key was missing.");
    await page.getByLabel("Authenticator code").fill(totp(secret, Date.now()));
    await page.getByRole("button", { name: "Verify and continue" }).click();
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByRole("heading", { name: "New study" })).toBeVisible();
  });
});
