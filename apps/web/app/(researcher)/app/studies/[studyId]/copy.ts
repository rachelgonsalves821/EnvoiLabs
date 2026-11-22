import type { StudyState } from "@envoi-labs/contracts";
import { researcherCopy } from "../../copy";

export const trackingCopy = {
  brand: researcherCopy.brand,
  navigation: researcherCopy.navigation,
  newStudy: researcherCopy.title,
  skip: "Skip to tracking",
  title: "Study tracking",
  counts: [
    ["invited", "Invited"], ["accepted", "Accepted"],
    ["completed", "Completed"], ["removed", "Removed"],
  ],
  completes: "completed interviews",
  estimatedFinish: "Estimated finish",
  retry: "Try again",
  unavailable: "Study tracking could not load.",
  refreshFailed: "The latest counts are unavailable. Showing the last confirmed counts.",
  accessEnded: "This study is no longer available in your session.",
  transcripts: "Redacted transcripts",
  transcriptsLoading: "Checking for redacted transcripts…",
  transcriptsEmpty: "No redacted transcripts are available yet.",
  transcriptsUnavailable: "Redacted transcripts could not be loaded.",
} as const;

export const stateLabels: Readonly<Record<StudyState, string>> = {
  draft: "Draft",
  scoping: "Scoping",
  brief_ready: "Brief ready",
  awaiting_payment: "Awaiting payment",
  fielding: "Fielding",
  fieldwork_complete: "Fieldwork complete",
  analyzing: "Analyzing",
  report_ready: "Report ready",
  closed: "Closed",
  paused: "Paused",
  cancelled: "Cancelled",
};
