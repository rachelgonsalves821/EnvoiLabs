import { chromium } from "@playwright/test";

export async function captureBrowserAudio(syntheticWav, channel) {
  const browser = await chromium.launch(channel ? { channel } : {});
  try {
    const page = await browser.newPage({ offline: true });
    await page.setContent('<button type="button">Record synthetic fixture</button>');
    await page.evaluate((wave) => {
      window.fixtureRecording = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Synthetic recording timed out.")), 15_000);
        document.querySelector("button").addEventListener("click", async () => {
          const context = new AudioContext();
          try {
            await context.resume();
            const buffer = await context.decodeAudioData(Uint8Array.from(wave).buffer);
            const source = context.createBufferSource();
            const destination = context.createMediaStreamDestination();
            const mime = "audio/webm;codecs=opus";
            const recorder = new MediaRecorder(destination.stream, { mimeType: mime });
            const chunks = [];
            recorder.addEventListener("dataavailable", (event) => chunks.push(event.data));
            const stopped = new Promise((done, fail) => {
              recorder.addEventListener("stop", done, { once: true });
              recorder.addEventListener("error", fail, { once: true });
            });
            source.buffer = buffer;
            source.connect(destination);
            source.addEventListener("ended", () => recorder.stop(), { once: true });
            recorder.start();
            source.start();
            await stopped;
            const audio = await new Blob(chunks, { type: mime }).arrayBuffer();
            resolve({ bytes: Array.from(new Uint8Array(audio)), seconds: buffer.duration });
          } catch (error) {
            reject(error);
          } finally {
            clearTimeout(timer);
            await context.close();
          }
        }, { once: true });
      });
    }, Array.from(syntheticWav));
    await page.getByRole("button", { name: "Record synthetic fixture" }).click();
    const capture = await page.evaluate(() => window.fixtureRecording);
    const audio = Uint8Array.from(capture.bytes);
    if (audio.length < 5 || audio.length > 256 * 1024 ||
        Buffer.from(audio.subarray(0, 4)).toString("hex") !== "1a45dfa3" ||
        !Number.isFinite(capture.seconds) || capture.seconds <= 0 || capture.seconds > 10) {
      throw new Error("Browser fixture is not a bounded WebM recording.");
    }
    return { file: "browser-recorded.webm", mime: "audio/webm", seconds: capture.seconds, audio };
  } finally {
    await browser.close();
  }
}
