import type { QuoteV4 } from "@envoi-labs/contracts";
import type { CheckoutProvider, CheckoutSession } from "@envoi-labs/services/checkout";

type StripeSession = {
  id?: unknown; object?: unknown; livemode?: unknown; mode?: unknown;
  client_reference_id?: unknown; amount_total?: unknown; currency?: unknown;
  status?: unknown; url?: unknown; metadata?: unknown;
};
type Requester = typeof fetch;

function validStripeSession(value: unknown): CheckoutSession {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid Stripe Checkout Session");
  const session = value as StripeSession;
  const metadata = session.metadata;
  if (session.object !== "checkout.session" || session.livemode !== false ||
    session.mode !== "payment" || typeof session.id !== "string" ||
    !session.id.startsWith("cs_test_") ||
    typeof session.client_reference_id !== "string" ||
    typeof session.amount_total !== "number" || session.amount_total <= 0 ||
    !Number.isSafeInteger(session.amount_total) || session.currency !== "usd" ||
    !metadata || typeof metadata !== "object" || Array.isArray(metadata) ||
    typeof session.url !== "string") throw new Error("Invalid Stripe Checkout Session");
  const tags = metadata as Record<string, unknown>;
  const version = Number(tags.pricingConfigVersion);
  if (tags.quoteId !== session.client_reference_id ||
    typeof tags.studyId !== "string" || !Number.isSafeInteger(version) || version < 1 ||
    !["open", "expired", "complete"].includes(String(session.status)))
    throw new Error("Stripe Checkout identity mismatch");
  return { id: session.id, studyId: tags.studyId, quoteId: session.client_reference_id,
    pricingConfigVersion: version, amountCents: session.amount_total,
    currency: "usd", status: session.status === "complete" ? "completed" :
      session.status as "open" | "expired", url: session.url };
}

export function createStripeTestCheckoutProvider(config: {
  secretKey: string; successUrl: string; cancelUrl: string;
  request?: Requester;
}): CheckoutProvider {
  if (!config.secretKey.startsWith("sk_test_") ||
    !URL.canParse(config.successUrl) || !URL.canParse(config.cancelUrl) ||
    new URL(config.successUrl).protocol !== "https:" ||
    new URL(config.cancelUrl).protocol !== "https:")
    throw new Error("Test-mode Stripe checkout configuration required");
  const request = config.request ?? fetch;
  const headers = (key?: string) => ({ Authorization: `Bearer ${config.secretKey}`,
    ...(key ? { "Idempotency-Key": key } : {}) });
  const decode = async (response: Response) => {
    if (!response.ok) throw new Error("Stripe Checkout unavailable");
    return validStripeSession(await response.json());
  };
  return {
    async create(key: string, quote: QuoteV4) {
      if (key !== `gate2-checkout:${quote.id}` || !Number.isSafeInteger(quote.totalCents) ||
        quote.totalCents <= 0) throw new Error("Invalid checkout intent");
      const form = new URLSearchParams({
        mode: "payment", success_url: config.successUrl, cancel_url: config.cancelUrl,
        client_reference_id: quote.id,
        "line_items[0][price_data][currency]": "usd",
        "line_items[0][price_data][unit_amount]": String(quote.totalCents),
        "line_items[0][price_data][product_data][name]": "Envoi Labs study",
        "line_items[0][quantity]": "1",
        "metadata[studyId]": quote.studyId, "metadata[quoteId]": quote.id,
        "metadata[pricingConfigVersion]": String(quote.pricingConfigVersion),
      });
      return decode(await request("https://api.stripe.com/v1/checkout/sessions", {
        method: "POST", headers: { ...headers(key),
          "Content-Type": "application/x-www-form-urlencoded" }, body: form,
      }));
    },
    async get(checkoutId: string) {
      if (!/^cs_test_[A-Za-z0-9_]+$/.test(checkoutId))
        throw new Error("Invalid test-mode Checkout Session ID");
      return decode(await request(`https://api.stripe.com/v1/checkout/sessions/${checkoutId}`,
        { method: "GET", headers: headers() }));
    },
  };
}
