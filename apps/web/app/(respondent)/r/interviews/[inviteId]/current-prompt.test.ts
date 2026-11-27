import { describe, expect, it } from "vitest";
import { SessionResponseSchema } from "@envoi-labs/contracts";
import { currentPrompt } from "./current-prompt";

const id = "019ac928-4718-7b62-b72d-8c9fb79b337c";
const session = { sessionId: id,
  progress: { sessionId: id, currentQuestion: 2, coreQuestionCount: 4, rewardCents: 400 },
  nextQuestion: { id, text: "What happened next?" },
  expiresAt: "2026-11-24T18:00:00.000Z" };

describe("respondent probe prompt selection", () => {
  it("uses the planned question on opt-out or unavailable probe", () => {
    expect(currentPrompt(SessionResponseSchema.parse({ ...session, currentProbe: null })))
      .toEqual({ kind: "core", id, text: "What happened next?" });
  });

  it("shows only the committed probe when the private read returns one", () => {
    expect(currentPrompt(SessionResponseSchema.parse({ ...session,
      currentProbe: { turnId: id, probeId: id, text: "Why did speed matter?" } })))
      .toEqual({ kind: "probe", id, text: "Why did speed matter?" });
  });

  it("holds the next core question while the latest answer is undecided", () => {
    expect(currentPrompt(SessionResponseSchema.parse({ ...session,
      currentProbe: null, probePending: true }))).toEqual({ kind: "pending" });
    expect(currentPrompt(SessionResponseSchema.parse({ ...session,
      currentProbe: { turnId: id, probeId: id, text: "Why did speed matter?" },
      probePending: true }))).toEqual({ kind: "probe", id,
        text: "Why did speed matter?" });
  });
});
