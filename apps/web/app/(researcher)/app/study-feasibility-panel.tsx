import type { FeasibilityView } from "@envoi-labs/ai";
import styles from "./researcher.module.css";

/** Render only after the current study and target have been authorized together. */
export function StudyFeasibilityPanel({ view, targetRespondents }: {
  view: FeasibilityView; targetRespondents: number;
}) {
  return (
    <section className={styles.feasibility} aria-labelledby="study-feasibility-heading">
      <h2 id="study-feasibility-heading">Matching outlook</h2>
      <p>{view.eligibleProfiles} eligible profiles now for {targetRespondents} requested respondent slots.</p>
      {view.status === "insufficient_data" &&
        <p>There is not enough observed offer and completion history to estimate how many will finish.</p>}
      {view.status === "below_target" &&
        <p>Current eligible supply or observed completion rates are below this target. Review the study criteria or target before checkout.</p>}
      {view.status === "directional_supply" &&
        <p>Based on past offers, about {view.projectedCompletes} people in the eligible pool may complete. This is an estimate, not a fill guarantee.</p>}
      <p>No finish time is available. Matching, acceptance and quality review determine the final number of approved completes.</p>
      <p className={styles.feasibilityAsOf}>Checked <time dateTime={view.asOf}>
        {new Date(view.asOf).toUTCString()}</time></p>
    </section>
  );
}
