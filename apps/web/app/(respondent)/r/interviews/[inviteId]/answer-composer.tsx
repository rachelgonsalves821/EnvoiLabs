"use client";

import { Button } from "@envoi-labs/ui";
import { useState } from "react";
import { TextAnswer } from "./text-answer";
import { VoiceAnswer } from "./voice-answer";
import { voiceCopy as voice } from "./voice-copy";

export function AnswerComposer({ canRecord, sessionId, questionId, onSaved }: {
  canRecord: boolean;
  sessionId: string;
  questionId: string;
  onSaved: () => void;
}) {
  const [typed, setTyped] = useState(false);
  const [textBusy, setTextBusy] = useState(false);
  return canRecord && !typed
    ? <VoiceAnswer sessionId={sessionId} questionId={questionId} onSaved={onSaved} onUseText={() => setTyped(true)} />
    : (
      <>
        <TextAnswer sessionId={sessionId} questionId={questionId} onSaved={onSaved} onBusyChange={setTextBusy} />
        {canRecord
          ? <Button variant="ghost" aria-disabled={textBusy} onClick={() => !textBusy && setTyped(false)}>{voice.record}</Button>
          : <a className="ev-button respondent-signup-link" href="/r/onboarding" data-variant="ghost">{voice.consent}</a>}
      </>
    );
}
