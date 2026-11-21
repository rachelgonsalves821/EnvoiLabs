import type { PayoutState } from "@envoi-labs/contracts";
import { applyStateChange, type TransitionContext } from "./transition.js";

export type PayoutEvent = "order" | "deliver" | "fail";

const transitions: Readonly<Record<PayoutState, Partial<Record<PayoutEvent, PayoutState>>>> = {
  pending: { order: "ordered" },
  ordered: { deliver: "delivered", fail: "failed" },
  delivered: {},
  failed: { order: "ordered" },
};

export function transitionPayout(
  state: PayoutState,
  event: PayoutEvent,
  context: TransitionContext & { persistedKey: string; requestKey: string },
) {
  if (event === "order" && (!context.persistedKey || context.persistedKey !== context.requestKey)) {
    throw new Error("A payout order must use its persisted idempotency key.");
  }
  return applyStateChange("payout", transitions, state, event, context);
}
