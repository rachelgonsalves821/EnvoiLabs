"use client";

import { useEffect, useState } from "react";

type Self = { code: string; attributed: boolean; profileVerified: boolean };
export function ReferralEntry({ initialCode }: { initialCode: string }) {
  const [self, setSelf] = useState<Self | null>(null);
  const [code, setCode] = useState(initialCode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let active = true;
    fetch("/api/respondent/referral", { credentials: "same-origin", cache: "no-store" })
      .then(async (response) => response.ok ? await response.json() as Self : null)
      .then((value) => { if (active) setSelf(value); })
      .catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, []);
  async function apply() {
    if (busy || !code.trim()) return;
    setBusy(true); setError(false);
    try {
      const response = await fetch("/api/respondent/referral", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });
      if (!response.ok) throw new Error("Referral unavailable");
      setSelf(await response.json() as Self);
    } catch { setError(true); }
    finally { setBusy(false); }
  }
  return <div>
    {self && <p>Your referral link: <a href={`/r/ref/${self.code}`}>
      {`/r/ref/${self.code}`}</a>{" "}
      <button type="button" onClick={() => {
        if (!navigator.clipboard) { setCopied(false); return; }
        void navigator.clipboard.writeText(
          new URL(`/r/ref/${self.code}`, window.location.origin).href)
          .then(() => setCopied(true)).catch(() => setCopied(false));
      }}>
        {copied ? "Copied" : "Copy link"}</button></p>}
    {self?.attributed ? <p role="status">{self.profileVerified
      ? "Your profile has been verified for a friend’s referral."
      : "Your referral is recorded. Complete your profile to be verified."}</p> : <>
      <label htmlFor="referral-code">Have a friend’s referral code?</label>
      <input id="referral-code" value={code} maxLength={36}
        onChange={(event) => setCode(event.target.value)} />
      <button type="button" className="ev-button" disabled={busy || !code.trim()}
        onClick={() => void apply()}>{busy ? "Checking…" : "Apply code"}</button>
    </>}
    {error && <p role="alert">We couldn’t apply that code. Check it and try again.</p>}
  </div>;
}
