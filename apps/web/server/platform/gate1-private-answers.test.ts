import { describe, expect, it, vi } from "vitest";
import { gate1InngestConfig } from "./gate1-inngest-config";
import { drainPrivateGate1Answers } from "./gate1-private-answers";

const hosted: NodeJS.ProcessEnv = {
  NODE_ENV: "production", VERCEL_ENV: "preview", ENVOI_GATE1_PRIVATE_ANSWERS_ENABLED: "1",
  INNGEST_SIGNING_KEY: "fixture-signing", SUPABASE_URL: "https://preview.example.test", SUPABASE_SERVICE_ROLE_KEY: "fixture-db",
};

describe("private answer scheduling", () => {
  it("uses a separate exact opt-in and an approved provider credential in the intended environment", () => {
    expect(gate1InngestConfig(hosted)).toBeNull();
    const voice = { ...hosted, OPENAI_API_KEY: "fixture-openai" };
    expect(gate1InngestConfig({ ...voice, ENVOI_GATE1_PRIVATE_ANSWERS_ENABLED: "true" })).toBeNull();
    expect(gate1InngestConfig({ ...voice, INNGEST_SIGNING_KEY: undefined })).toBeNull();
    expect(gate1InngestConfig(voice)).toMatchObject({ expiryEnabled: false, privateAnswersEnabled: true });
    expect(gate1InngestConfig({ ...hosted, GROQ_API_KEY: "fixture-groq", ENVOI_GATE1_EXPIRY_ENABLED: "1" }))
      .toMatchObject({ expiryEnabled: true, privateAnswersEnabled: true });
    expect(gate1InngestConfig({ ...hosted, GROQ_API_KEY: " ", ENVOI_GATE1_EXPIRY_ENABLED: "1" }))
      .toMatchObject({ expiryEnabled: true, privateAnswersEnabled: false });
  });

  it("stops on idle and emits only a count", async () => {
    const runNext = vi.fn().mockResolvedValue("idle");
    const runStep = vi.fn((_id: string, operation: () => Promise<boolean>) => operation());
    await expect(drainPrivateGate1Answers(runStep, runNext)).resolves.toEqual({ examined: 0 });
    expect(runStep).toHaveBeenCalledTimes(1);
    expect(runNext).toHaveBeenCalledTimes(1);
  });

  it("limits one schedule to four jobs and resumes durable steps without repeating the worker", async () => {
    const results = new Map<string, boolean>();
    const runStep = async (id: string, operation: () => Promise<boolean>) => {
      if (!results.has(id)) results.set(id, await operation());
      return results.get(id) ?? false;
    };
    const runNext = vi.fn().mockResolvedValueOnce("retry").mockResolvedValue("private");
    await expect(drainPrivateGate1Answers(runStep, runNext)).resolves.toEqual({ examined: 4 });
    await expect(drainPrivateGate1Answers(runStep, runNext)).resolves.toEqual({ examined: 4 });
    expect(runNext).toHaveBeenCalledTimes(4);
    expect([...results.values()]).toEqual([true, true, true, true]);
  });

  it("sanitizes worker failures and lets a later attempt continue", async () => {
    const runStep = (_id: string, operation: () => Promise<boolean>) => operation();
    const runNext = vi.fn().mockRejectedValueOnce(new Error("synthetic restricted input"))
      .mockResolvedValueOnce("private").mockResolvedValueOnce("idle");
    await expect(drainPrivateGate1Answers(runStep, runNext)).rejects.toEqual(new Error("The private answer queue could not be checked."));
    await expect(drainPrivateGate1Answers(runStep, runNext)).resolves.toEqual({ examined: 1 });
  });
});
