import { describe, expect, it } from "vitest";
import type { StudyState } from "@envoi-labs/contracts";
import {
  transitionInvite, transitionPayout, transitionSession, transitionStudy, type StudyEvent,
} from "../src/index.js";

const entityId = "90600000-0000-4000-8000-000000000001";
const start = new Date("2026-11-21T18:00:00.000Z");
const deadline = new Date("2026-11-22T18:00:00.000Z");
const context = { entityId, actor: "platform", now: start };
const active = { ...context, expiresAt: deadline };
const expired = { ...active, now: deadline };
const payout = { ...context, persistedKey: "payout:fixture", requestKey: "payout:fixture" };

describe("study lifecycle", () => {
  it.each([
    ["draft", "begin_scoping", "scoping"],
    ["draft", "cancel", "cancelled"],
    ["scoping", "approve_brief", "brief_ready"],
    ["scoping", "cancel", "cancelled"],
    ["brief_ready", "request_payment", "awaiting_payment"],
    ["brief_ready", "cancel", "cancelled"],
    ["awaiting_payment", "confirm_payment", "fielding"],
    ["awaiting_payment", "cancel", "cancelled"],
    ["fielding", "complete_fieldwork", "fieldwork_complete"],
    ["fielding", "pause", "paused"],
    ["fielding", "cancel", "cancelled"],
    ["fieldwork_complete", "begin_analysis", "analyzing"],
    ["analyzing", "publish_report", "report_ready"],
    ["report_ready", "close", "closed"],
    ["paused", "resume", "fielding"],
    ["paused", "cancel", "cancelled"],
  ] as const)("%s + %s changes to %s", (state, event, next) => {
    expect(transitionStudy(state, event, context)).toEqual({
      state: next,
      audit: { entity: "study", entityId, actor: "platform", fromState: state, toState: next, at: start.toISOString() },
    });
  });

  it("requires explicit server authorization to launch an unpaid draft in preview", () => {
    expect(() => transitionStudy("draft", "launch_test", context)).toThrow(/preview authorization/);
    expect(transitionStudy("draft", "launch_test", { ...context, allowTestLaunch: true }).state).toBe("fielding");
    expect(() => transitionStudy("closed", "launch_test", { ...context, allowTestLaunch: true })).toThrow(/closed/);
    expect(() => transitionStudy("draft", "confirm_payment", context)).toThrow(/draft/);
  });

  it("rejects values inherited from object prototypes", () => {
    expect(() => transitionStudy("draft", "constructor" as StudyEvent, context)).toThrow(/draft/);
    expect(() => transitionStudy("constructor" as StudyState, "close", context)).toThrow(/constructor/);
  });
});

describe("invite lifecycle", () => {
  it.each([
    ["matched", "require_screening", "screening"],
    ["matched", "send", "invited"],
    ["screening", "send", "invited"],
    ["screening", "screen_out", "screened_out"],
    ["invited", "accept", "accepted"],
    ["invited", "decline", "declined"],
    ["invited", "screen_out", "screened_out"],
  ] as const)("%s + %s changes to %s", (state, event, next) => {
    expect(transitionInvite(state, event, active)).toMatchObject({
      state: next, audit: { entity: "invite", fromState: state, toState: next },
    });
  });

  it("expires at the deadline and closes acceptance at the same instant", () => {
    expect(() => transitionInvite("invited", "expire", active)).toThrow(/deadline/);
    expect(() => transitionInvite("invited", "accept", expired)).toThrow(/deadline/);
    expect(() => transitionInvite("screening", "accept", active)).toThrow(/screening/);
    expect(transitionInvite("invited", "expire", expired).state).toBe("expired");
  });
});

describe("session lifecycle", () => {
  it.each([
    ["started", "begin", "in_progress"],
    ["in_progress", "submit", "submitted"],
    ["submitted", "hold", "quality_hold"],
    ["quality_hold", "approve", "approved"],
    ["quality_hold", "remove", "removed"],
    ["approved", "pay", "paid"],
  ] as const)("%s + %s changes to %s", (state, event, next) => {
    expect(transitionSession(state, event, active)).toMatchObject({
      state: next, audit: { entity: "session", fromState: state, toState: next },
    });
  });

  it("expires unfinished sessions and preserves submitted sessions", () => {
    expect(() => transitionSession("started", "expire", active)).toThrow(/deadline/);
    expect(() => transitionSession("started", "begin", expired)).toThrow(/deadline/);
    expect(() => transitionSession("in_progress", "submit", expired)).toThrow(/deadline/);
    expect(transitionSession("started", "expire", expired).state).toBe("abandoned");
    expect(transitionSession("in_progress", "expire", expired).state).toBe("abandoned");
    expect(() => transitionSession("submitted", "expire", expired)).toThrow(/submitted/);
    expect(() => transitionSession("abandoned", "expire", expired)).toThrow(/abandoned/);
  });
});

describe("payout lifecycle", () => {
  it.each([
    ["pending", "order", "ordered"],
    ["ordered", "deliver", "delivered"],
    ["ordered", "fail", "failed"],
    ["failed", "order", "ordered"],
  ] as const)("%s + %s changes to %s", (state, event, next) => {
    expect(transitionPayout(state, event, payout)).toMatchObject({
      state: next, audit: { entity: "payout", fromState: state, toState: next },
    });
  });

  it("guards retries with the persisted key and prohibits a second delivered order", () => {
    expect(() => transitionPayout("failed", "order", { ...payout, requestKey: "different" })).toThrow(/idempotency key/);
    expect(() => transitionPayout("failed", "order", { ...payout, persistedKey: "" })).toThrow(/idempotency key/);
    expect(() => transitionPayout("delivered", "order", payout)).toThrow(/delivered/);
  });
});
