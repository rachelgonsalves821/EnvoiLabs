type Fields = Record<string, unknown>;
const object = (value: unknown): value is Fields =>
  value !== null && typeof value === "object" && !Array.isArray(value);
function cents(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  const rounded = Math.round(value * 100);
  return Number.isSafeInteger(rounded) && Math.abs(rounded / 100 - value) < 0.000001
    ? rounded : null;
}

/** Fail closed until the account catalog confirms this exact Visa product. */
export function supportsReservedVisaPayout(product: unknown, request: {
  productId: string; country: string; amountCents: number;
}): boolean {
  if (!object(product) || product.id !== request.productId ||
    product.category !== "visa_card" ||
    !/^[A-Z]{2}$/.test(request.country) ||
    !Number.isSafeInteger(request.amountCents) || request.amountCents <= 0 ||
    !Array.isArray(product.currency_codes) ||
    !product.currency_codes.includes("USD") ||
    !Array.isArray(product.countries) ||
    !product.countries.some((entry) => object(entry) && entry.abbr === request.country) ||
    !Array.isArray(product.skus)) return false;
  return product.skus.some((entry) => {
    if (!object(entry) || entry.currency_code !== "USD") return false;
    const min = cents(entry.min);
    const max = cents(entry.max);
    return min !== null && max !== null && min <= max &&
      request.amountCents >= min && request.amountCents <= max;
  });
}
