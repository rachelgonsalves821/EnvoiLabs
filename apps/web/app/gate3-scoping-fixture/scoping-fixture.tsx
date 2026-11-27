"use client";

import { useState } from "react";
import { ScopingWorkspace, type ScopingSnapshot, type ScopingWorkspacePort } from
  "../(researcher)/app/scoping-workspace";

export function FictionalScopingFixture() {
  const [fixture] = useState(() => {
    let current: ScopingSnapshot | null = { revision: "fictional-1", stage: "decision",
      brief: {}, messages: [{ role: "agent", text: "What decision will this study inform?",
        quickReplies: ["Improve checkout", "Change shipping", "Something else"] }] };
    let next = 2;
    const port: ScopingWorkspacePort = {
      async readCurrent() {
        await new Promise((resolve) => window.setTimeout(resolve, 100));
        return current;
      },
      async send({ revision, text }) {
        await new Promise((resolve) => window.setTimeout(resolve, 100));
        if (!current || current.revision !== revision) return null;
        current = { revision: `fictional-${next++}`, stage: "hypotheses",
          brief: { ...current.brief, decision: text },
          messages: [...current.messages, { role: "researcher", text },
            { role: "agent", text: "What do you expect people to have done?",
              quickReplies: ["Compared options", "Stopped at checkout", "Something else"] }] };
        return current;
      },
      async edit({ revision, patch }) {
        await new Promise((resolve) => window.setTimeout(resolve, 100));
        if (!current || current.revision !== revision) return null;
        current = { ...current, revision: `fictional-${next++}`,
          brief: { ...current.brief, ...patch },
          messages: [...current.messages, { role: "agent", text: "I updated the brief.",
            quickReplies: ["Continue", "Something else"] }] };
        return current;
      },
    };
    return { port, revoke: () => { current = null; } };
  });
  return <main style={{ maxWidth: 1050, marginInline: "auto", padding: 16 }}>
    <h1>Fictional scoping fixture</h1>
    <ScopingWorkspace port={fixture.port} />
    <button type="button" data-fixture-revoke onClick={() => {
      fixture.revoke(); document.dispatchEvent(new Event("visibilitychange"));
    }}>Revoke fictional brief</button>
  </main>;
}
