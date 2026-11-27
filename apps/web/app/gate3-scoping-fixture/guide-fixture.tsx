"use client";

import { useState } from "react";
import { GuideReviewPanel, type GuideReviewPort, type GuideReviewSnapshot } from
  "../(researcher)/app/guide-review-panel";

const questions = ["Wouldn't you prefer a faster checkout?", "When did you last shop online?",
  "What were you looking for?", "What options did you compare?",
  "What happened at checkout?", "What did you do afterward?"];

export function FictionalGuideFixture() {
  const [fixture] = useState(() => {
    let current: GuideReviewSnapshot | null = { revision: "fictional-guide-1",
      questions, approved: false };
    let revision = 2;
    const port: GuideReviewPort = {
      async readCurrent() {
        await new Promise((resolve) => window.setTimeout(resolve, 100));
        return current;
      },
      async save(input) {
        await new Promise((resolve) => window.setTimeout(resolve, 100));
        if (!current || current.revision !== input.revision) return null;
        current = { revision: `fictional-guide-${revision++}`, questions: [...input.questions],
          approved: input.approved };
        return current;
      },
      async rewrite({ revision: previous, index }) {
        await new Promise((resolve) => window.setTimeout(resolve, 100));
        if (!current || current.revision !== previous) return null;
        const revised = [...current.questions];
        revised[index] = "Tell me about the last time you compared a price?";
        current = { revision: `fictional-guide-${revision++}`, questions: revised, approved: false };
        return current;
      },
    };
    return { port, revoke: () => { current = null; } };
  });
  return <main style={{ maxWidth: 820, marginInline: "auto", padding: 16,
    boxSizing: "border-box" }}>
    <h1>Fictional guide fixture</h1>
    <GuideReviewPanel port={fixture.port} />
    <button type="button" data-fixture-revoke onClick={() => {
      fixture.revoke(); document.dispatchEvent(new Event("visibilitychange"));
    }}>Revoke fictional guide</button>
  </main>;
}
