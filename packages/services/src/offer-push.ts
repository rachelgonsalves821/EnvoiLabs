export type ClaimedOfferPush = {
  deliveryId: string;
  claimId: string;
  inviteId: string;
  respondentId: string;
  expiresAt: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
};
export type OfferPushLedger = {
  readCandidates(): Promise<readonly string[]>;
  enqueue(inviteId: string): Promise<boolean>;
  listDispatchable(): Promise<readonly string[]>;
  prepare(outboxId: string): Promise<readonly string[]>;
  claim(deliveryId: string, claimId: string): Promise<ClaimedOfferPush | null>;
  observe(deliveryId: string, claimId: string,
    state: "sent" | "failed"): Promise<boolean>;
};
export type OfferPushTransport = {
  send(destination: { endpoint: string; keys: { p256dh: string; auth: string } },
    payload: { kind: "matched_offer"; path: "/r" }): Promise<"sent" | "failed">;
};

/** A claimed uncertain send is intentionally never retried automatically. */
export async function dispatchMatchedOfferPush(input: {
  ledger: OfferPushLedger;
  transport: OfferPushTransport;
  newClaimId(): string;
  now?: () => Date;
}) {
  const result = { queued: 0, sent: 0, failed: 0, unresolved: 0 };
  let candidates: readonly string[];
  try { candidates = await input.ledger.readCandidates(); }
  catch { return { ...result, unresolved: 1 }; }
  for (const inviteId of candidates) {
    try { if (await input.ledger.enqueue(inviteId)) result.queued += 1; }
    catch { result.unresolved += 1; }
  }
  let outboxIds: readonly string[];
  try { outboxIds = await input.ledger.listDispatchable(); }
  catch { return { ...result, unresolved: result.unresolved + 1 }; }
  for (const outboxId of outboxIds) {
    let deliveryIds: readonly string[];
    try { deliveryIds = await input.ledger.prepare(outboxId); }
    catch { result.unresolved += 1; continue; }
    for (const deliveryId of deliveryIds) {
      const claimId = input.newClaimId();
      let claim: ClaimedOfferPush | null;
      try { claim = await input.ledger.claim(deliveryId, claimId); }
      catch { result.unresolved += 1; continue; }
      if (!claim) continue;
      const deadline = Date.parse(claim.expiresAt);
      if (claim.deliveryId !== deliveryId || claim.claimId !== claimId ||
          !claim.endpoint.startsWith("https://") ||
          !claim.keys?.p256dh || !claim.keys?.auth ||
          !Number.isFinite(deadline) ||
          deadline <= (input.now?.() ?? new Date()).getTime()) {
        try {
          if (await input.ledger.observe(deliveryId, claimId, "failed"))
            result.failed += 1;
          else result.unresolved += 1;
        } catch { result.unresolved += 1; }
        continue;
      }
      try {
        const outcome = await input.transport.send(
          { endpoint: claim.endpoint, keys: claim.keys },
          { kind: "matched_offer", path: "/r" });
        if (outcome !== "sent" && outcome !== "failed") {
          result.unresolved += 1;
          continue;
        }
        if (await input.ledger.observe(deliveryId, claimId, outcome))
          result[outcome] += 1;
        else result.unresolved += 1;
      } catch { result.unresolved += 1; }
    }
  }
  return result;
}
