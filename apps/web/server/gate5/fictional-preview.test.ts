import { describe, expect, it } from "vitest";
import { fictionalWalkthroughEnabled } from "./fictional-preview";

describe("fictional walkthrough labels", () => {
  const enabled = { ENVOI_GATE5_FICTIONAL_WALKTHROUGH: "true" };
  it("stays off by default and in production", () => {
    expect(fictionalWalkthroughEnabled({})).toBe(false);
    expect(fictionalWalkthroughEnabled({ ...enabled, VERCEL_ENV: "production",
      ENVOI_GATE5_ISOLATION_APPROVED: "true" })).toBe(false);
  });
  it("requires an approved preview or exact local loopback fixture", () => {
    expect(fictionalWalkthroughEnabled({ ...enabled, VERCEL_ENV: "preview" })).toBe(false);
    expect(fictionalWalkthroughEnabled({ ...enabled, VERCEL_ENV: "preview",
      ENVOI_GATE5_ISOLATION_APPROVED: "true" })).toBe(true);
    expect(fictionalWalkthroughEnabled({ ...enabled, ENVOI_TEST_LOCAL_SUPABASE: "1",
      SUPABASE_URL: "https://production.example.test" })).toBe(false);
    expect(fictionalWalkthroughEnabled({ ...enabled, ENVOI_TEST_LOCAL_SUPABASE: "1",
      SUPABASE_URL: "http://127.0.0.1:54321" })).toBe(true);
  });
});
