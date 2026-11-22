import { expect, type Page } from "@playwright/test";
import { RecordAnswerResponseSchema } from "@envoi-labs/contracts";

const fixtureObjects = ["11111111-1111-4111-8111-111111111111", "11111111-1111-4111-8111-111111111112"];

async function allowSyntheticMicrophone(page: Page) {
  await page.evaluate(() => {
    (window as unknown as { syntheticMicrophone: { allowed: boolean } }).syntheticMicrophone.allowed = true;
  });
}

async function stopRecordedTone(page: Page) {
  await expect(page.getByRole("main").getByRole("status")).toContainText("Recording");
  await expect(page.locator(".respondent-record-timer span[aria-hidden]")).toHaveText("0:01");
  await page.getByRole("button", { name: "Stop recording" }).click();
  const player = page.locator("audio");
  await expect(player).toHaveAttribute("src", /^blob:/);
  expect(await player.evaluate((node) => {
    const audio = node as HTMLAudioElement;
    return audio.paused && !audio.autoplay;
  })).toBe(true);
  await expect.poll(() => player.evaluate((audio) => (audio as HTMLAudioElement).readyState)).toBeGreaterThan(0);
  const url = await player.getAttribute("src");
  if (!url) throw new Error("The synthetic audio preview is missing.");
  return url;
}

/** Replaces microphone input with a generated tone on the next navigation. */
export async function installSyntheticMicrophone(page: Page) {
  await page.addInitScript(() => {
    const test = Object.assign(window, { syntheticMicrophone: { requests: 0, allowed: false, revoked: [] as string[] } });
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL = (url) => {
      test.syntheticMicrophone.revoked.push(url);
      revoke(url);
    };
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: async () => {
        test.syntheticMicrophone.requests++;
        if (!test.syntheticMicrophone.allowed) throw new DOMException("Synthetic microphone denial.", "NotAllowedError");
        const context = new AudioContext();
        const destination = context.createMediaStreamDestination();
        const oscillator = context.createOscillator();
        oscillator.connect(destination);
        oscillator.start();
        await context.resume();
        const stream = destination.stream;
        for (const track of stream.getTracks()) {
          const stop = track.stop.bind(track);
          track.stop = () => { stop(); oscillator.stop(); void context.close(); };
        }
        return stream;
      },
    });
  });
}

/** Exercises permission, retry and recording controls with intercepted transfers. */
export async function exerciseVoiceRecording(page: Page, origin: string, inviteId: string) {
  await installSyntheticMicrophone(page);
  const reservations: { sessionId: string; guideQuestionId: string; bytes: number; mime: string }[] = [];
  const confirmations: { answerId: string; audioObjectId: string; durationMs: number; sessionId: string; guideQuestionId: string }[] = [];
  const puts: number[] = [];
  await page.route("**/api/respondent/answers/upload", async (route) => {
    reservations.push(route.request().postDataJSON());
    await route.fulfill({ json: { audioObjectId: fixtureObjects[reservations.length - 1],
      uploadUrl: origin + "/synthetic-voice-put/" + reservations.length,
      expiresAt: new Date(Date.now() + 600_000).toISOString() } });
  });
  await page.route("**/synthetic-voice-put/*", async (route) => {
    expect(route.request().method()).toBe("PUT");
    expect(route.request().headers()["content-type"]).toBe("audio/webm");
    expect((await route.request().allHeaders()).cookie).toBeUndefined();
    puts.push(route.request().postDataBuffer()?.length ?? 0);
    await route.fulfill({ status: puts.length <= 3 ? 503 : 201 });
  });
  await page.route("**/api/respondent/answers/record", async (route) => {
    const payload = route.request().postDataJSON();
    if (payload.kind !== "voice") return route.continue();
    confirmations.push(payload);
    if (confirmations.length === 1) return route.fulfill({ status: 503, json: { ok: false } });
    const instant = new Date().toISOString();
    return route.fulfill({ json: { answer: {
      id: payload.answerId, sessionId: payload.sessionId, guideQuestionId: payload.guideQuestionId,
      kind: "voice", durationMs: payload.durationMs, createdAt: instant, updatedAt: instant, probeId: null, sequence: 1,
    } } });
  });

  const state = () => page.evaluate(() => (window as unknown as {
    syntheticMicrophone: { allowed: boolean; requests: number; revoked: string[] };
  }).syntheticMicrophone);
  await page.goto("/r/interviews/" + inviteId);
  const start = page.getByRole("button", { name: "Start recording" });
  await expect(start).toBeVisible();
  expect((await state()).requests).toBe(0);
  await start.click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Microphone access is blocked.");
  await expect(page.getByRole("button", { name: "Type instead" })).toBeVisible();
  expect((await state()).requests).toBe(1);
  await allowSyntheticMicrophone(page);

  await start.click();
  expect(reservations).toHaveLength(0);
  const discarded = await stopRecordedTone(page);
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("Your recording couldn’t upload. Try again.");
  await expect(page.locator("audio")).toHaveAttribute("src", discarded);
  await page.getByRole("button", { name: "Retry upload" }).click();
  await expect(page.getByRole("button", { name: "Save recording" })).toBeEnabled();
  expect(confirmations).toHaveLength(0);
  await page.getByRole("button", { name: "Record again" }).click();
  await expect.poll(async () => (await state()).revoked.includes(discarded)).toBe(true);
  const saved = await stopRecordedTone(page);
  expect(saved).not.toBe(discarded);
  await expect(page.getByRole("button", { name: "Save recording" })).toBeEnabled();
  expect(confirmations).toHaveLength(0);
  expect(reservations).toHaveLength(2);
  expect(puts).toHaveLength(5);

  await page.getByRole("button", { name: "Save recording" }).click();
  await expect.poll(() => confirmations.length).toBe(2);
  await expect.poll(async () => (await state()).revoked.includes(saved)).toBe(true);
  expect(reservations[1]).toMatchObject({ mime: "audio/webm" });
  expect(puts[4]).toBe(reservations[1]?.bytes);
  expect(puts[4]).toBeGreaterThan(0);
  expect(confirmations[0]).toEqual(confirmations[1]);
  expect(confirmations[0]).toMatchObject({
    audioObjectId: fixtureObjects[1], sessionId: reservations[1]?.sessionId,
    guideQuestionId: reservations[1]?.guideQuestionId,
  });
  expect(confirmations[0]?.durationMs).toBeGreaterThanOrEqual(1000);
  await page.unroute("**/api/respondent/answers/upload");
  await page.unroute("**/synthetic-voice-put/*");
  await page.unroute("**/api/respondent/answers/record");
}

/** Records a synthetic take through the real disposable app and Storage routes. */
export async function submitSyntheticRecording(page: Page) {
  await allowSyntheticMicrophone(page);
  await page.getByRole("button", { name: "Start recording" }).click();
  const put = page.waitForResponse((response) =>
    response.request().method() === "PUT"
      && new URL(response.url()).origin === process.env.SUPABASE_URL
      && new URL(response.url()).pathname.startsWith("/storage/v1/object/upload/sign/gate1-interview-audio/"),
  );
  await stopRecordedTone(page);
  const uploaded = await put;
  expect(uploaded.ok()).toBe(true);
  expect(uploaded.request().headers()["content-type"]).toBe("audio/webm");
  expect((await uploaded.request().allHeaders()).cookie).toBeUndefined();
  const [confirmation] = await Promise.all([
    page.waitForResponse((response) => response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/respondent/answers/record"),
    page.getByRole("button", { name: "Save recording" }).click(),
  ]);
  expect(confirmation.status()).toBe(200);
  const result: unknown = await confirmation.json();
  return RecordAnswerResponseSchema.parse(result).answer;
}
