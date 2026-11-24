import { describe, expect, it, vi } from "vitest";
import { QuoteV4Schema } from "@envoi-labs/contracts";
import { createStripeTestCheckoutProvider } from "./gate2-stripe-test";

const quote = QuoteV4Schema.parse((QuoteV4Schema.meta()?.examples as unknown[])[0]);
const session = { id: "cs_test_fixture_1", object: "checkout.session", livemode: false,
  mode: "payment", client_reference_id: quote.id, amount_total: quote.totalCents,
  currency: "usd", status: "open", url: "https://checkout.stripe.com/c/pay/cs_test_fixture_1",
  metadata: { studyId: quote.studyId, quoteId: quote.id,
    pricingConfigVersion: String(quote.pricingConfigVersion) } };
const response = (body: unknown) => ({ ok: true, json: async () => body }) as Response;
const config = { secretKey: "sk_test_disposable_fixture", successUrl: "https://example.test/paid",
  cancelUrl: "https://example.test/cancel" };

describe("Stripe test-mode Checkout adapter", () => {
  it("creates once with frozen quote metadata and its durable idempotency key", async () => {
    const request = vi.fn().mockResolvedValue(response(session));
    const provider = createStripeTestCheckoutProvider({ ...config, request });
    const checkout = await provider.create(`gate2-checkout:${quote.id}`, quote);
    expect(checkout).toMatchObject({ id: session.id, quoteId: quote.id,
      amountCents: quote.totalCents, status: "open" });
    const [url, init] = request.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.stripe.com/v1/checkout/sessions");
    expect(init.headers).toMatchObject({ "Idempotency-Key": `gate2-checkout:${quote.id}` });
    const body = init.body as URLSearchParams;
    expect(body.get("client_reference_id")).toBe(quote.id);
    expect(body.get("metadata[studyId]")).toBe(quote.studyId);
    expect(body.get("line_items[0][price_data][unit_amount]")).toBe(String(quote.totalCents));
  });

  it("retrieves a stored exact test Session ID without a new POST", async () => {
    const request = vi.fn().mockResolvedValue(response(session));
    const provider = createStripeTestCheckoutProvider({ ...config, request });
    expect(await provider.get(session.id)).toMatchObject({ id: session.id });
    expect(request).toHaveBeenCalledWith(
      `https://api.stripe.com/v1/checkout/sessions/${session.id}`,
      expect.objectContaining({ method: "GET" }));
    await expect(provider.get("cs_live_1")).rejects.toThrow("test-mode");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("rejects live keys and provider quote, amount or mode mismatches", async () => {
    expect(() => createStripeTestCheckoutProvider({ ...config, secretKey: "sk_live_1" }))
      .toThrow("Test-mode");
    const request = vi.fn().mockResolvedValueOnce(response({ ...session,
      client_reference_id: "other" })).mockResolvedValueOnce(response({ ...session,
        amount_total: 0 })).mockResolvedValueOnce(response({ ...session, livemode: true }));
    const provider = createStripeTestCheckoutProvider({ ...config, request });
    await expect(provider.create(`gate2-checkout:${quote.id}`, quote)).rejects.toThrow();
    await expect(provider.create(`gate2-checkout:${quote.id}`, quote)).rejects.toThrow();
    await expect(provider.create(`gate2-checkout:${quote.id}`, quote)).rejects.toThrow();
  });

  it("surfaces uncertain provider responses without manufacturing a Session ID", async () => {
    const request = vi.fn().mockRejectedValue(new Error("connection lost"));
    const provider = createStripeTestCheckoutProvider({ ...config, request });
    await expect(provider.create(`gate2-checkout:${quote.id}`, quote)).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(1);
  });
});
