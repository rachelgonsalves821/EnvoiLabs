import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { StudyFeasibilityPanel } from "../../app/(researcher)/app/study-feasibility-panel";

const asOf = "2026-11-24T20:00:00.000Z";

it("explains sparse history without inventing a fill estimate", () => {
  const html = renderToStaticMarkup(<StudyFeasibilityPanel targetRespondents={12}
    view={{ eligibleProfiles: 18, projectedCompletes: null,
      status: "insufficient_data", asOf }} />);
  expect(html).toContain("18 eligible profiles now for 12 requested respondent slots");
  expect(html).toContain("not enough observed offer and completion history");
  expect(html).toContain("No finish time is available");
  expect(html).not.toContain("guaranteed");
});

it("labels an observed projection as directional and flags a shortfall", () => {
  const observed = renderToStaticMarkup(<StudyFeasibilityPanel targetRespondents={10}
    view={{ eligibleProfiles: 25, projectedCompletes: 20,
      status: "directional_supply", asOf }} />);
  expect(observed).toContain("about 20 people in the eligible pool may complete");
  expect(observed).toContain("not a fill guarantee");
  const shortfall = renderToStaticMarkup(<StudyFeasibilityPanel targetRespondents={10}
    view={{ eligibleProfiles: 25, projectedCompletes: 8,
      status: "below_target", asOf }} />);
  expect(shortfall).toContain("Review the study criteria or target before checkout");
});
