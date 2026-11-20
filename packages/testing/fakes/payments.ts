class FakeIdempotency<Value extends object> {
  private readonly records = new Map<string, { fingerprint: string; value: Value }>();

  execute(key: string, fields: readonly (string | number)[], create: (sequence: number) => Value): Value {
    if (key.length === 0) throw new Error("An idempotency key is required.");
    const fingerprint = JSON.stringify(fields);
    const match = this.records.get(key);
    if (match !== undefined) {
      if (match.fingerprint !== fingerprint) throw new Error("The idempotency key is already in use for different parameters.");
      return { ...match.value };
    }
    const value = create(this.records.size + 1);
    this.records.set(key, { fingerprint, value });
    return { ...value };
  }
}

function requirePositiveCents(amountCents: number): void {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) throw new Error("Amount must be positive integer cents.");
}

export class FakeStripe {
  private readonly checkouts = new FakeIdempotency<{ id: string; url: string; amountCents: number }>();
  private readonly refunds = new FakeIdempotency<{ id: string; amountCents: number }>();
  private readonly balances = new Map<string, number>();

  createCheckout(input: { studyId: string; amountCents: number; idempotencyKey: string }) {
    requirePositiveCents(input.amountCents);
    return this.checkouts.execute(input.idempotencyKey, [input.studyId, input.amountCents], (number) => {
      const id = `cs_test_${number}`;
      this.balances.set(id, input.amountCents);
      return { id, url: `https://stripe-fixture.invalid/checkout/${id}`, amountCents: input.amountCents };
    });
  }

  refund(input: { checkoutId: string; amountCents: number; idempotencyKey: string }) {
    requirePositiveCents(input.amountCents);
    return this.refunds.execute(input.idempotencyKey, [input.checkoutId, input.amountCents], (number) => {
      const balance = this.balances.get(input.checkoutId);
      if (balance === undefined || input.amountCents > balance) throw new Error("Refund exceeds the remaining checkout balance.");
      this.balances.set(input.checkoutId, balance - input.amountCents);
      return { id: `re_test_${number}`, amountCents: input.amountCents };
    });
  }
}

export class FakeTremendous {
  private readonly orders = new FakeIdempotency<{ id: string; status: "ordered"; amountCents: number }>();

  createOrder(input: { recipientId: string; productId: string; amountCents: number; idempotencyKey: string }) {
    requirePositiveCents(input.amountCents);
    return this.orders.execute(input.idempotencyKey, [input.recipientId, input.productId, input.amountCents], (number) => ({
      id: `gift_test_${number}`, status: "ordered", amountCents: input.amountCents,
    }));
  }
}
