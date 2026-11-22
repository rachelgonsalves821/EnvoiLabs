import { describe, expect, it } from "vitest";
import { createResumeLink, verifyResumeToken } from "./resume-link";

const invite = "00000000-0000-4000-8000-000000000001";
const respondent = "00000000-0000-4000-8000-000000000002";
const stranger = "00000000-0000-4000-8000-000000000003";
const start = Date.parse("2026-11-22T12:00:00Z");
const expiry = "2026-11-23T12:00:00Z";
const key = "synthetic-resume-test-key";

describe("signed interview resume links", () => {
  it("binds the invite and exact expiry to the signed-in respondent", () => {
    const token = createResumeLink(invite, respondent, expiry, start, key)!.slice("/r/s/".length);
    expect(verifyResumeToken(token, respondent, start, key)).toBe(invite);
    expect(verifyResumeToken(token, stranger, start, key)).toBeNull();
    expect(verifyResumeToken(token, respondent, Date.parse(expiry), key)).toBeNull();
    expect(verifyResumeToken(token.replace(invite, stranger), respondent, start, key)).toBeNull();
    expect(verifyResumeToken(token, respondent, start, "rotated-key")).toBeNull();
  });

  it("rejects expired, malformed and unsigned inputs", () => {
    expect(createResumeLink(invite, respondent, expiry, Date.parse(expiry), key)).toBeNull();
    expect(createResumeLink("not-an-invite", respondent, expiry, start, key)).toBeNull();
    expect(createResumeLink(invite, respondent, expiry, start, "")).toBeNull();
    expect(verifyResumeToken("not-a-token", respondent, start, key)).toBeNull();
  });
});
