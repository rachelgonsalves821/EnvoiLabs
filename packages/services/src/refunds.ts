export type RefundReservationRpc = (name: "reserve_gate2_unfilled_slot_refund",
  args: { supplied_study_id: string; supplied_quote_id: string;
    supplied_auth_user_id: string }) =>
  PromiseLike<{ data: unknown; error: { code: string } | null }>;

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

export async function reserveUnfilledSlotRefund(call: RefundReservationRpc,
  studyId: string, quoteId: string, authUserId: string) {
  if (![studyId, quoteId, authUserId].every((value) => uuid.test(value)))
    return { status: "blocked" } as const;
  try {
    const { data, error } = await call("reserve_gate2_unfilled_slot_refund", {
      supplied_study_id: studyId, supplied_quote_id: quoteId,
      supplied_auth_user_id: authUserId,
    });
    if (error?.code === "23514" || error?.code === "42501")
      return { status: "blocked" } as const;
    if (error) return { status: "unavailable" } as const;
    if (data === null) return { status: "fully_filled" } as const;
    if (!data || typeof data !== "object" || Array.isArray(data))
      return { status: "unavailable" } as const;
    const value = data as Record<string, unknown>;
    if (typeof value.reservationId !== "string" || !uuid.test(value.reservationId) ||
      !Number.isSafeInteger(value.amountCents) || (value.amountCents as number) <= 0 ||
      !Number.isSafeInteger(value.unfilledSlots) || (value.unfilledSlots as number) <= 0 ||
      value.idempotencyKey !== `gate2-unfilled-refund:${quoteId}` ||
      Object.keys(value).length !== 4) return { status: "unavailable" } as const;
    return { status: "reserved", reservationId: value.reservationId,
      amountCents: value.amountCents as number,
      unfilledSlots: value.unfilledSlots as number,
      idempotencyKey: value.idempotencyKey } as const;
  } catch { return { status: "unavailable" } as const; }
}
