import { describe, expect, it, vi } from "vitest";
import { removeExpiredGate2ScreeningAudio } from "./gate2-screening-audio-cleanup.mjs";

const name = "screening/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222";
function setup(rows = [{ storage_path: name }]) {
  const rpc = vi.fn(async () => ({ data: rows, error: null }));
  const remove = vi.fn(async () => ({ error: null }));
  const from = vi.fn(() => ({ remove }));
  return { rpc, remove, from, client: { rpc, storage: { from } } };
}
describe("private screening audio cleanup", () => {
  it("removes only bounded selected objects from the private bucket", async () => {
    const { client, rpc, remove, from } = setup();
    expect(await removeExpiredGate2ScreeningAudio(client)).toBe(1);
    expect(rpc).toHaveBeenCalledWith("list_gate2_expired_screening_audio", { supplied_limit: 50 });
    expect(from).toHaveBeenCalledWith("gate2-screening-audio");
    expect(remove).toHaveBeenCalledWith([name]);
  });
  it("never removes malformed or duplicated paths", async () => {
    const malformed = setup([{ storage_path: "other/object" }]);
    await expect(removeExpiredGate2ScreeningAudio(malformed.client)).rejects.toThrow("invalid path");
    expect(malformed.remove).not.toHaveBeenCalled();
    const duplicate = setup([{ storage_path: name }, { storage_path: name }]);
    await expect(removeExpiredGate2ScreeningAudio(duplicate.client)).rejects.toThrow("invalid path");
    expect(duplicate.remove).not.toHaveBeenCalled();
  });
  it("treats missing objects and storage outages separately", async () => {
    const empty = setup([]);
    expect(await removeExpiredGate2ScreeningAudio(empty.client)).toBe(0);
    expect(empty.from).not.toHaveBeenCalled();
    const outage = setup();
    outage.remove.mockResolvedValueOnce({ error: { message: "storage unavailable" } });
    await expect(removeExpiredGate2ScreeningAudio(outage.client)).rejects.toThrow("could not remove");
    await expect(removeExpiredGate2ScreeningAudio(outage.client, 51)).rejects.toThrow("bounded");
  });
});
