import { describe, expect, it, vi } from "vitest";
import { settleReservedRefund, type RefundSettlementDatabase,
  type RefundSettlementProvider } from "../src/refund-settlement";

const reservationId = "a9850000-0000-4000-8000-000000000002";
const authUserId = "90200000-0000-4000-8000-000000000001";
const quoteId = "a9850000-0000-4000-8000-000000000003";
const base = { checkoutId: "cs_test_refund_1", amountCents: 1000,
  quoteId, studyId: "a9850000-0000-4000-8000-000000000001",
  quoteTotalCents: 12000, pricingConfigVersion: 101 };
const observation = { refundId: "re_refund_1", kind: "pending" as const,
  amountCents: 1000, observedAt: "2026-11-24T12:00:00.000Z" };
function setup(claim: Awaited<ReturnType<RefundSettlementDatabase["claim"]>>) {
  const database: RefundSettlementDatabase = { claim: vi.fn(async () => claim),
    record: vi.fn(async () => true) };
  const provider: RefundSettlementProvider = {
    create: vi.fn(async () => observation), get: vi.fn(async () => observation),
  };
  return { database, provider };
}
const run = (parts: ReturnType<typeof setup>) => settleReservedRefund({
  reservationId, authUserId, ...parts });

describe("reserved refund settlement", () => {
  it("creates once only after a durable claim and records pending status", async () => {
    const parts = setup({ status: "create", ...base,
      key: `gate2-unfilled-refund:${quoteId}` });
    await expect(run(parts)).resolves.toMatchObject({ status: "pending",
      amountCents: 1000, refundId: "re_refund_1" });
    expect(parts.provider.create).toHaveBeenCalledTimes(1);
    expect(parts.provider.get).not.toHaveBeenCalled();
    expect(parts.database.record).toHaveBeenCalledWith(reservationId, observation);
  });
  it("retrieves the stored refund on retry and never calls create", async () => {
    const parts = setup({ status: "known", ...base, refundId: "re_refund_1" });
    await expect(run(parts)).resolves.toMatchObject({ status: "pending" });
    expect(parts.provider.create).not.toHaveBeenCalled();
    expect(parts.provider.get).toHaveBeenCalledTimes(1);
  });
  it.each(["blocked", "unavailable"] as const)("%s claim makes no provider call", async (status) => {
    const parts = setup({ status });
    await expect(run(parts)).resolves.toEqual({ status });
    expect(parts.provider.create).not.toHaveBeenCalled();
    expect(parts.provider.get).not.toHaveBeenCalled();
  });
  it("rejects inconsistent provider amount before ledger write", async () => {
    const parts = setup({ status: "create", ...base,
      key: `gate2-unfilled-refund:${quoteId}` });
    vi.mocked(parts.provider.create).mockResolvedValueOnce({ ...observation,
      amountCents: 1200 });
    await expect(run(parts)).resolves.toEqual({ status: "unavailable" });
    expect(parts.database.record).not.toHaveBeenCalled();
  });
});
