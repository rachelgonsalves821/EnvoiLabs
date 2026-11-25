import { describe, expect, it } from "vitest";
import { supportsReservedVisaPayout } from "../src/visa-product.js";

const product = { id: "sandbox-visa", category: "visa_card",
  currency_codes: ["USD"], countries: [{ abbr: "US" }],
  skus: [{ min: 10, max: 500, currency_code: "USD" }] };
const request = { productId: "sandbox-visa", country: "US", amountCents: 1000 };

describe("synthetic prepaid Visa catalog eligibility", () => {
  it("requires the exact account-selected product and supported SKU band", () => {
    expect(supportsReservedVisaPayout(product, request)).toBe(true);
    expect(supportsReservedVisaPayout(product, { ...request, amountCents: 100 }))
      .toBe(false);
    expect(supportsReservedVisaPayout(product, { ...request, amountCents: 50001 }))
      .toBe(false);
    expect(supportsReservedVisaPayout(product, { ...request, productId: "other" }))
      .toBe(false);
  });
  it("rejects another category, geography, currency or malformed catalog", () => {
    expect(supportsReservedVisaPayout({ ...product, category: "merchant_card" }, request))
      .toBe(false);
    expect(supportsReservedVisaPayout(product, { ...request, country: "CA" }))
      .toBe(false);
    expect(supportsReservedVisaPayout({ ...product, currency_codes: ["CAD"] }, request))
      .toBe(false);
    expect(supportsReservedVisaPayout({ ...product,
      skus: [{ min: 10.001, max: 500, currency_code: "USD" }] }, request))
      .toBe(false);
    expect(supportsReservedVisaPayout({ ...product, skus: [] }, request))
      .toBe(false);
  });
});
