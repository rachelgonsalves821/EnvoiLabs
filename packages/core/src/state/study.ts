import type { StudyState } from "@envoi-labs/contracts";
import { applyStateChange, type TransitionContext } from "./transition.js";

export type StudyEvent =
  | "begin_scoping" | "approve_brief" | "request_payment" | "confirm_payment" | "launch_test"
  | "complete_fieldwork" | "begin_analysis" | "publish_report" | "close" | "pause" | "resume" | "cancel";

const transitions: Readonly<Record<StudyState, Partial<Record<StudyEvent, StudyState>>>> = {
  draft: { begin_scoping: "scoping", launch_test: "fielding", cancel: "cancelled" },
  scoping: { approve_brief: "brief_ready", cancel: "cancelled" },
  brief_ready: { request_payment: "awaiting_payment", cancel: "cancelled" },
  awaiting_payment: { confirm_payment: "fielding", cancel: "cancelled" },
  fielding: { complete_fieldwork: "fieldwork_complete", pause: "paused", cancel: "cancelled" },
  fieldwork_complete: { begin_analysis: "analyzing" },
  analyzing: { publish_report: "report_ready" },
  report_ready: { close: "closed" },
  paused: { resume: "fielding", cancel: "cancelled" },
  closed: {},
  cancelled: {},
};

export function transitionStudy(
  state: StudyState,
  event: StudyEvent,
  context: TransitionContext & { allowTestLaunch?: boolean },
) {
  if (event === "launch_test" && context.allowTestLaunch !== true) {
    throw new Error("An unpaid test launch requires explicit preview authorization.");
  }
  return applyStateChange("study", transitions, state, event, context);
}
