import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { VoiceAnswer } from "../app/(respondent)/r/interviews/[inviteId]/voice-answer";

const { useCapture, echo } = vi.hoisted(() => ({ useCapture: vi.fn(), echo: vi.fn() }));
vi.mock("../app/(respondent)/r/interviews/[inviteId]/use-voice-capture", () => ({
  useVoiceCapture: useCapture,
}));
vi.mock("@envoi-labs/ui", async (importOriginal) => ({
  ...await importOriginal<typeof import("@envoi-labs/ui")>(),
  Echo: (props: { state: string; level: () => number }) => { echo(props); return null; },
}));

describe("voice answer Echo input", () => {
  it("passes the live local recorder level to the listening renderer", () => {
    const level = vi.fn(() => 0.7);
    useCapture.mockReturnValue({ state: { kind: "recording", elapsedSeconds: 1 },
      error: null, level, start: vi.fn(), stop: vi.fn(), discard: vi.fn() });
    renderToStaticMarkup(createElement(VoiceAnswer, { sessionId: "session", questionId: "question",
      onUseText: vi.fn(), onSaved: vi.fn() }));
    expect(echo).toHaveBeenCalledOnce();
    const props = echo.mock.calls[0]?.[0] as { state: string; level: () => number };
    expect(props.state).toBe("listen");
    expect(props.level).toBe(level);
    expect(props.level()).toBe(0.7);
    expect(props.level()).not.toBe(0);
  });
});
