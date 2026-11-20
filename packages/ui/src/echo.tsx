export type EchoState = "idle" | "listen" | "think" | "sent" | "payout";

export interface EchoProps {
  state: EchoState;
  size: number;
  level?: () => number;
  "aria-hidden"?: boolean;
}

const stateLabels: Record<EchoState, string> = {
  idle: "Echo",
  listen: "Recording",
  think: "Preparing a follow-up",
  sent: "Answer saved",
  payout: "Payout",
};

export function Echo({ state, size, "aria-hidden": hidden = true }: EchoProps) {
  return (
    <span
      className="ev-echo"
      data-state={state}
      style={{ inlineSize: size, blockSize: size }}
      aria-hidden={hidden}
      role={hidden ? undefined : "img"}
      aria-label={hidden ? undefined : stateLabels[state]}
    />
  );
}
