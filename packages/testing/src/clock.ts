export class TestClock {
  private time: number;

  constructor(start: string | Date = "2026-11-19T18:00:00.000Z") {
    this.time = new Date(start).getTime();
    if (!Number.isFinite(this.time)) throw new Error("Test clock requires a valid start time.");
  }

  readonly now = (): Date => new Date(this.time);

  advance(durationMs: number): Date {
    if (!Number.isSafeInteger(durationMs) || durationMs < 0) throw new Error("Use a nonnegative millisecond duration.");
    const next = this.time + durationMs;
    if (!Number.isFinite(new Date(next).getTime())) throw new Error("Test clock is outside the Date range.");
    this.time = next;
    return this.now();
  }
}
