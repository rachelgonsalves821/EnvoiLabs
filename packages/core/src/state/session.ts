import type { SessionState } from "@envoi-labs/contracts";
import { applyStateChange, type TransitionContext } from "./transition.js";

export type SessionEvent = "begin" | "submit" | "hold" | "approve" | "remove" | "pay" | "expire";

const transitions: Readonly<Record<SessionState, Partial<Record<SessionEvent, SessionState>>>> = {
  started: { begin: "in_progress", expire: "abandoned" },
  in_progress: { submit: "submitted", expire: "abandoned" },
  submitted: { hold: "quality_hold" },
  quality_hold: { approve: "approved", remove: "removed" },
  approved: { pay: "paid" },
  removed: {},
  paid: {},
  abandoned: {},
};

export function transitionSession(
  state: SessionState,
  event: SessionEvent,
  context: TransitionContext & { expiresAt: Date },
) {
  if (event === "expire" && !(context.now >= context.expiresAt)) {
    throw new Error("A session can expire only after its deadline.");
  }
  if ((event === "begin" || event === "submit") && !(context.now < context.expiresAt)) {
    throw new Error("The session deadline has passed.");
  }
  return applyStateChange("session", transitions, state, event, context);
}
