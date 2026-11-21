import type { InviteState } from "@envoi-labs/contracts";
import { applyStateChange, type TransitionContext } from "./transition.js";

export type InviteEvent = "require_screening" | "send" | "accept" | "decline" | "expire" | "screen_out";

const transitions: Readonly<Record<InviteState, Partial<Record<InviteEvent, InviteState>>>> = {
  matched: { require_screening: "screening", send: "invited" },
  screening: { send: "invited", screen_out: "screened_out" },
  invited: { accept: "accepted", decline: "declined", expire: "expired", screen_out: "screened_out" },
  accepted: {},
  declined: {},
  expired: {},
  screened_out: {},
};

export function transitionInvite(
  state: InviteState,
  event: InviteEvent,
  context: TransitionContext & { expiresAt: Date },
) {
  if (event === "expire" && !(context.now >= context.expiresAt)) {
    throw new Error("An invite can expire only after its deadline.");
  }
  if (event === "accept" && !(context.now < context.expiresAt)) {
    throw new Error("The invite deadline has passed.");
  }
  return applyStateChange("invite", transitions, state, event, context);
}
