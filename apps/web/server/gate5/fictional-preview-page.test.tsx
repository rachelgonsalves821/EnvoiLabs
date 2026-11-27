import { afterEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import RespondentEarningsPage from "../../app/(respondent)/r/earnings/page";
import { readCurrentEarnings } from "../respondent/earnings";

vi.mock("../auth/identity", () => ({ requireRespondent: vi.fn(async () => {}) }));
vi.mock("../auth/supabase", () => ({ sessionClient: vi.fn() }));
vi.mock("../respondent/earnings", () => ({ readCurrentEarnings: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("next/navigation", () => ({ notFound: vi.fn() }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

it("does not read or render persisted synthetic money when preview mode is off", async () => {
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("ENVOI_GATE2_EARNINGS_ENABLED", "true");
  vi.stubEnv("ENVOI_GATE5_FICTIONAL_WALKTHROUGH", "false");
  vi.stubEnv("ENVOI_GATE5_ISOLATION_APPROVED", "true");

  const markup = renderToStaticMarkup(await RespondentEarningsPage());
  expect(readCurrentEarnings).not.toHaveBeenCalled();
  expect(markup).toContain("Amounts and receipts are withheld");
  expect(markup).not.toContain("Delivered");
  expect(markup).not.toContain("Receipt");
  expect(markup).not.toContain("$");
});
