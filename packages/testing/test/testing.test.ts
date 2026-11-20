import { describe, expect, it } from "vitest";
import {
  FakeLLM, FakeStripe, FakeTranscriber, FakeTremendous, FakeTwilio, TestClock,
  fakeLlmRequestHash, fakeTranscriptionAudioHash, fixtureFactory,
} from "../src/index.js";

describe("offline test adapters", () => {
  it("provides stable checkout and refund receipts on retry", () => {
    const provider = new FakeStripe();
    const checkout = { studyId: "study-1", amountCents: 500, idempotencyKey: "checkout-1" };
    const created = provider.createCheckout(checkout);
    expect(provider.createCheckout(checkout)).toEqual(created);
    expect(() => provider.createCheckout({ ...checkout, amountCents: 600 })).toThrow("different parameters");
    expect(() => provider.createCheckout({ ...checkout, amountCents: 5.5 })).toThrow("integer cents");

    const refund = { checkoutId: created.id, amountCents: 400, idempotencyKey: "refund-1" };
    const refunded = provider.refund(refund);
    expect(provider.refund(refund)).toEqual(refunded);
    expect(() => provider.refund({ ...refund, idempotencyKey: "refund-2" })).toThrow("remaining checkout balance");
  });

  it("creates a gift card order once for an idempotency key", () => {
    const provider = new FakeTremendous();
    const payout = { recipientId: "respondent-1", productId: "gift-card", amountCents: 200, idempotencyKey: "payout-1" };
    expect(provider.createOrder(payout)).toMatchObject({ id: "gift_test_1", status: "ordered" });
    expect(provider.createOrder(payout)).toMatchObject({ id: "gift_test_1" });
    expect(() => provider.createOrder({ ...payout, recipientId: "respondent-2" })).toThrow("different parameters");
  });

  it("expires and consumes fixture phone codes without advancing wall time", () => {
    const clock = new TestClock();
    const provider = new FakeTwilio({ code: "123456", now: clock.now, expiryMs: 500 });
    const phone = "+12025550123";
    provider.sendVerification(phone);
    expect(provider.verify(phone, "000000")).toBe(false);
    clock.advance(500);
    expect(provider.verify(phone, "123456")).toBe(false);
    provider.sendVerification(phone);
    expect(provider.verify(phone, "123456")).toBe(true);
    expect(provider.verify(phone, "123456")).toBe(false);
  });

  it("replays scripted and hash-keyed AI fixtures and fails closed on misses", async () => {
    const request = { purpose: "scoping", promptVersion: "v1", system: "Test only", messages: [] };
    const response = {
      output: { title: "Example study" }, model: "fixture", inputTokens: 0,
      outputTokens: 0, latencyMs: 0, costMicros: 0,
    };
    const scripted = new FakeLLM({ script: [response] });
    await expect(scripted.generate(request)).resolves.toEqual(response);
    await expect(scripted.generate(request)).rejects.toThrow("No LLM fixture");

    const replay = new FakeLLM({ fixtures: new Map([[await fakeLlmRequestHash(request), response]]) });
    expect(await replay.generate(request) === response).toBe(false);
    await expect(replay.generate({ ...request, promptVersion: "v2" })).rejects.toThrow("No LLM fixture");

    const audio = new Uint8Array([1, 2, 3]);
    const transcriber = new FakeTranscriber(new Map([[await fakeTranscriptionAudioHash(audio), "Example text"]]));
    await expect(transcriber.transcribe({ audio, mediaType: "audio/webm" })).resolves.toMatchObject({ text: "Example text" });
    await expect(transcriber.transcribe({ audio: new Uint8Array([9]), mediaType: "audio/webm" })).rejects.toThrow("No transcription");
  });

  it("creates isolated examples and validates overrides", () => {
    const defaultValue = { label: "Example" };
    const makeFixture = fixtureFactory({
      meta: () => ({ examples: [defaultValue] }),
      parse: (value) => {
        if (typeof value !== "object" || value === null || !("label" in value) || typeof value.label !== "string" || value.label === "") {
          throw new Error("Invalid label.");
        }
        return { label: value.label };
      },
    });
    makeFixture().label = "Changed";
    expect(makeFixture()).toEqual(defaultValue);
    expect(makeFixture({ label: "Override" })).toEqual({ label: "Override" });
    expect(() => makeFixture({ label: "" })).toThrow("Invalid label");
  });
});
