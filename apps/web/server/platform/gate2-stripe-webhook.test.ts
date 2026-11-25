import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyStripeTestCheckoutHint } from "./gate2-stripe-webhook";

const secret = "whsec_fixture";
const now = () => 1_795_526_400_000;
const payload = JSON.stringify({ id: "evt_test_1", object: "event", livemode: false,
  type: "checkout.session.completed",
  data: { object: { object: "checkout.session", id: "cs_test_fixture_1" } } });
const raw = (body: string) => new TextEncoder().encode(body);
const signed = (body: string, timestamp = 1_795_526_400) =>
  `t=${timestamp},v1=${createHmac("sha256", secret)
    .update(`${timestamp}.`).update(raw(body)).digest("hex")}`;

describe("signed Stripe test Checkout hint", () => {
  it("accepts only an authentic recent raw body", () => {
    expect(verifyStripeTestCheckoutHint({ rawBody: raw(payload),
      signature: signed(payload), secret, now })).toEqual({
      eventId: "evt_test_1", type: "checkout.session.completed",
      checkoutId: "cs_test_fixture_1" });
    expect(verifyStripeTestCheckoutHint({ rawBody: raw(payload + " "),
      signature: signed(payload), secret, now })).toBeNull();
    expect(verifyStripeTestCheckoutHint({ rawBody: raw(payload),
      signature: signed(payload, 1_795_526_000), secret, now })).toBeNull();
  });
  it("rejects live mode, unsupported event and wrong object despite a valid signature", () => {
    for (const body of [payload.replace('"livemode":false', '"livemode":true'),
      payload.replace("checkout.session.completed", "customer.created"),
      payload.replace("cs_test_fixture_1", "cs_live_wrong")]) {
      expect(verifyStripeTestCheckoutHint({ rawBody: raw(body),
        signature: signed(body), secret, now })).toBeNull();
    }
  });
  it("rejects missing signature and duplicate timestamps", () => {
    expect(verifyStripeTestCheckoutHint({ rawBody: raw(payload), signature: null,
      secret, now })).toBeNull();
    expect(verifyStripeTestCheckoutHint({ rawBody: raw(payload),
      signature: `${signed(payload)},t=1795526400`, secret, now })).toBeNull();
  });
});
