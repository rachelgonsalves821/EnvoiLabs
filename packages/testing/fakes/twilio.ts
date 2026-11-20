export class FakeTwilio {
  private readonly pending = new Map<string, number>();
  private readonly code: string;
  private readonly now: () => Date;
  private readonly expiryMs: number;

  constructor(options: { code: string; now: () => Date; expiryMs?: number }) {
    this.code = options.code;
    this.now = options.now;
    this.expiryMs = options.expiryMs ?? 10 * 60_000;
    if (!/^\d{6}$/.test(this.code)) throw new Error("Use a six-digit fixture verification code.");
    if (!Number.isSafeInteger(this.expiryMs) || this.expiryMs <= 0) throw new Error("Use a positive expiry duration.");
  }

  sendVerification(phone: string): void {
    if (!/^\+[1-9]\d{6,14}$/.test(phone)) throw new Error("Use an E.164 fixture phone number.");
    this.pending.set(phone, this.now().getTime() + this.expiryMs);
  }

  verify(phone: string, code: string): boolean {
    const expiresAt = this.pending.get(phone);
    if (expiresAt === undefined) return false;
    if (this.now().getTime() >= expiresAt) {
      this.pending.delete(phone);
      return false;
    }
    if (code !== this.code) return false;
    this.pending.delete(phone);
    return true;
  }
}
