import { describe, expect, it, vi } from "vitest";
import { runGate1OrphanAudioCleanup } from "./gate1-orphan-audio";

const sessionId = "11111111-1111-4111-8111-111111111111";
const first = `${sessionId}/22222222-2222-4222-8222-222222222222`;
const second = `${sessionId}/33333333-3333-4333-8333-333333333333`;

describe("Gate 1 expired audio cleanup", () => {
  it("lists a bounded batch and only requests each listed path once", async () => {
    const list = vi.fn().mockResolvedValue({ data: [first, second, first].map((storage_path) => ({ storage_path })) });
    const remove = vi.fn().mockResolvedValue({ error: null });

    await expect(runGate1OrphanAudioCleanup({ list, remove })).resolves.toEqual({ requested: 2 });
    expect(list).toHaveBeenCalledWith(50);
    expect(remove).toHaveBeenCalledExactlyOnceWith([first, second]);
  });

  it.each([
    { data: null },
    { data: [{ storage_path: first }, { storage_path: `${second}\n` }] },
    { data: [{ storage_path: `other-bucket/${first}` }] },
    { data: Array.from({ length: 51 }, () => ({ storage_path: first })) },
  ])(
    "rejects a malformed or oversized batch without issuing a delete",
    async ({ data }) => {
      const list = vi.fn().mockResolvedValue({ data });
      const remove = vi.fn();

      await expect(runGate1OrphanAudioCleanup({ list, remove })).rejects.toThrow("Gate 1 expired audio listing failed.");
      expect(remove).not.toHaveBeenCalled();
    },
  );

  it("sanitizes a provider failure and lists again after a partial removal", async () => {
    const list = vi.fn()
      .mockResolvedValueOnce({ data: [{ storage_path: first }, { storage_path: second }] })
      .mockResolvedValueOnce({ data: [{ storage_path: second }] })
      .mockResolvedValueOnce({ data: [] });
    const remove = vi.fn()
      .mockResolvedValueOnce({ error: new Error(first) })
      .mockResolvedValueOnce({ error: null });

    await expect(runGate1OrphanAudioCleanup({ list, remove })).rejects.toThrow(/^Gate 1 expired audio removal failed\.$/);
    await expect(runGate1OrphanAudioCleanup({ list, remove })).resolves.toEqual({ requested: 1 });
    await expect(runGate1OrphanAudioCleanup({ list, remove })).resolves.toEqual({ requested: 0 });
    expect(remove.mock.calls).toEqual([[[first, second]], [[second]]]);
  });

  it("lists again on the next sweep for an upload that arrived after an empty sweep", async () => {
    const list = vi.fn()
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [{ storage_path: first }] });
    const remove = vi.fn().mockResolvedValue({ error: null });

    await expect(runGate1OrphanAudioCleanup({ list, remove })).resolves.toEqual({ requested: 0 });
    await expect(runGate1OrphanAudioCleanup({ list, remove })).resolves.toEqual({ requested: 1 });
    expect(remove).toHaveBeenCalledExactlyOnceWith([first]);
  });
});
