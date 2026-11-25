import type { NudgeKind } from "./nudges";

export type ClaimedNudgeDelivery = {
  deliveryId: string;
  claimId: string;
  inviteId: string;
  respondentId: string;
  expiresAt: string;
  kind: NudgeKind;
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

export type NudgeDeliveryLedger = {
  listDispatchable(): Promise<readonly string[]>;
  prepare(outboxId: string): Promise<readonly string[]>;
  // A claimed row never returns here again, even for the same claim ID.
  claim(deliveryId: string, claimId: string): Promise<ClaimedNudgeDelivery | null>;
  observe(deliveryId: string, claimId: string, state: "sent" | "failed"): Promise<boolean>;
};

export type NudgeTransport = {
  send(destination: { endpoint: string; keys: { p256dh: string; auth: string } },
    payload: { kind: NudgeKind; path: string }): Promise<"sent" | "failed">;
};

const resumePath = /^\/r\/s\/[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}\.\d{13}\.[A-Za-z0-9_-]{43}$/i;

export async function deliverQueuedNudges(input: {
  ledger: NudgeDeliveryLedger;
  transport: NudgeTransport;
  newClaimId(): string;
  makeResumePath(inviteId: string, respondentId: string, expiresAt: string): string | null;
  now?: () => Date;
}) {
  const result = { prepared: 0, sent: 0, failed: 0, unresolved: 0 };
  for (const outboxId of await input.ledger.listDispatchable()) {
    let deliveryIds: readonly string[];
    try { deliveryIds = await input.ledger.prepare(outboxId); }
    catch { result.unresolved += 1; continue; }
    for (const deliveryId of deliveryIds) {
      const claimId = input.newClaimId();
      let claim: ClaimedNudgeDelivery | null;
      try { claim = await input.ledger.claim(deliveryId, claimId); }
      catch { result.unresolved += 1; continue; }
      if (!claim) continue;
      result.prepared += 1;
      if (claim.deliveryId !== deliveryId || claim.claimId !== claimId ||
        !claim.endpoint.startsWith("https://") ||
        !claim.keys?.p256dh || !claim.keys?.auth) {
        result.unresolved += 1;
        continue;
      }
      let path: string | null = null;
      try {
        path = input.makeResumePath(claim.inviteId,
          claim.respondentId, claim.expiresAt);
      } catch { /* A signing failure is a definite no-send. */ }
      const deadline = Date.parse(claim.expiresAt);
      const valid = path && resumePath.test(path) && Number.isFinite(deadline) &&
        deadline > (input.now?.() ?? new Date()).getTime() &&
        (claim.kind === "halfway" || claim.kind === "two_hours_left");
      if (!valid) {
        try {
          if (await input.ledger.observe(deliveryId, claimId, "failed")) result.failed += 1;
          else result.unresolved += 1;
        } catch { result.unresolved += 1; }
        continue;
      }
      try {
        const sent = await input.transport.send(
          { endpoint: claim.endpoint, keys: claim.keys },
          { kind: claim.kind, path: path! });
        if (sent !== "sent" && sent !== "failed") { result.unresolved += 1; continue; }
        if (await input.ledger.observe(deliveryId, claimId, sent)) result[sent] += 1;
        else result.unresolved += 1;
      } catch { result.unresolved += 1; }
    }
  }
  return result;
}
