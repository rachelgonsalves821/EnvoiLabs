import { describe, expect, it } from "vitest";
import { TestClock } from "../../testing/src/clock";
import { selectDueNudge, type NudgeCandidate } from "../src/nudges";

const candidate: NudgeCandidate = {
  inviteId: "offer-1", sessionId: "session-1", state: "in_progress",
  expiresAt: "2026-11-25T12:00:00.000Z", coreQuestionCount: 5,
  answeredCoreCount: 3, lastActivityAt: "2026-11-24T13:00:00.000Z",
  snoozedUntil: null, sentKinds: [],
};

describe("IT-2.6 push nudge timing", () => {
  it("enqueues one halfway stall reminder after two quiet hours", () => {
    const clock = new TestClock("2026-11-24T14:59:59.000Z");
    expect(selectDueNudge(candidate, clock.now)).toBeNull();
    clock.advance(1000);
    expect(selectDueNudge(candidate, clock.now)).toEqual({
      inviteId: "offer-1", sessionId: "session-1", kind: "halfway",
      idempotencyKey: "gate2-nudge:offer-1:halfway",
      title: "You’re halfway through", body: "Continue your study where you stopped.",
    });
    expect(selectDueNudge({ ...candidate, sentKinds: ["halfway"] }, clock.now)).toBeNull();
  });

  it("prioritizes the two-hours-left reminder and respects snooze and expiry", () => {
    const clock = new TestClock("2026-11-25T09:59:59.000Z");
    expect(selectDueNudge({ ...candidate, sentKinds: ["halfway"] }, clock.now)).toBeNull();
    clock.advance(1000);
    expect(selectDueNudge(candidate, clock.now)?.kind).toBe("two_hours_left");
    expect(selectDueNudge({ ...candidate, snoozedUntil: "2026-11-25T11:00:00.000Z" },
      clock.now)).toBeNull();
    clock.advance(60 * 60 * 1000);
    expect(selectDueNudge(candidate, clock.now)?.idempotencyKey)
      .toBe("gate2-nudge:offer-1:two_hours_left");
    expect(selectDueNudge({ ...candidate, sentKinds: ["two_hours_left"] }, clock.now)).toBeNull();
    clock.advance(60 * 60 * 1000);
    expect(selectDueNudge(candidate, clock.now)).toBeNull();
  });

  it("does not remind declined, complete, active or invalid sessions", () => {
    const clock = new TestClock("2026-11-24T15:00:00.000Z");
    expect(selectDueNudge({ ...candidate, state: "removed" }, clock.now)).toBeNull();
    expect(selectDueNudge({ ...candidate, answeredCoreCount: 5 }, clock.now)).toBeNull();
    expect(selectDueNudge({ ...candidate, answeredCoreCount: 2 }, clock.now)).toBeNull();
    expect(selectDueNudge({ ...candidate,
      lastActivityAt: "2026-11-24T14:30:00.000Z" }, clock.now)).toBeNull();
    expect(selectDueNudge({ ...candidate, expiresAt: "bad" }, clock.now)).toBeNull();
  });
});
