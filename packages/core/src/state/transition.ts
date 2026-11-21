import type { AuditLog } from "@envoi-labs/contracts";

type Entity = "study" | "invite" | "session" | "payout";

export interface TransitionContext {
  entityId: string;
  actor: string;
  now: Date;
}

export interface TransitionResult<State> {
  state: State;
  audit: Pick<AuditLog, "entity" | "entityId" | "fromState" | "toState" | "at"> & { actor: string };
}

export function applyStateChange<State extends string, Event extends string>(
  entity: Entity,
  transitions: Readonly<Record<State, Partial<Record<Event, State>>>>,
  state: State,
  event: Event,
  { entityId, actor, now }: TransitionContext,
): TransitionResult<State> {
  const choices = Object.hasOwn(transitions, state) ? transitions[state] : null;
  const nextState = choices && Object.hasOwn(choices, event) ? choices[event] : undefined;
  if (nextState === undefined) throw new Error(`Cannot ${event} ${entity} in state ${state}.`);
  return {
    state: nextState,
    audit: { entity, entityId, fromState: state, toState: nextState, actor, at: now.toISOString() },
  };
}
