"use client";

import { UpdateInviteResponseSchema, type UpdateInviteRequest } from "@envoi-labs/contracts";
import { Button } from "@envoi-labs/ui";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { homeCopy as copy } from "./copy";
import { interviewRequest } from "./interview-request";

export function InviteActions({ inviteId, primary }: { inviteId: string; primary: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const sending = useRef(false);

  async function update(action: UpdateInviteRequest["action"]) {
    if (sending.current) return;
    sending.current = true;
    setPending(true);
    setError("");
    const response = await interviewRequest(`/api/respondent/invites/${action}`, { inviteId, action });
    sending.current = false;
    setPending(false);
    const result = UpdateInviteResponseSchema.safeParse(response.data);
    const expectedState = action === "accept" ? "accepted" : "declined";
    if (result.success && result.data.inviteId === inviteId && result.data.state === expectedState) {
      if (action === "accept") {
        router.push(`/r/interviews/${inviteId}`);
      } else {
        document.getElementById("respondent-studies-heading")?.focus();
        router.refresh();
      }
      return;
    }
    if (response.status === 401) setError(copy.signInAgain);
    else if (response.status === 404 || response.status === 409) setError(copy.unavailable);
    else setError(copy.actionFailed);
  }

  return (
    <>
      <div className="respondent-invite-actions">
        <Button variant={primary ? "pulse" : "secondary"} aria-disabled={pending} onClick={() => void update("accept")}>
          {copy.start}
        </Button>
        <Button variant="ghost" aria-disabled={pending} onClick={() => void update("decline")}>
          {copy.decline}
        </Button>
      </div>
      {pending && <p role="status">{copy.sending}</p>}
      {error && <p role="alert">{error}</p>}
    </>
  );
}
