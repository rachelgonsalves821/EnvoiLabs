# VoiceAnswer

How a respondent's spoken answer, the agent's live follow-up and the recording state appear in the interview thread.

The consumer provides the audio URL and duration, the transcript snippet (first 140 characters), the follow-up text and the recording timer.

- **Answer bubble.** `ink` fill, right-aligned, play button in `pulse`, waveform in `on-ink`, transcript snippet under it so people can check we heard them right. Tapping the snippet opens a sheet to fix the text.
- **Follow-up.** The agent's probe sits left-aligned in `body-l` with a 40px Echo in `think` state while it is being written, then `idle`.
- **Recording row.** `pulse-wash` pill with a `critical` dot, the word "Recording", a live waveform and the timer. It is a `role="status"` live region.

Keep follow-ups to one or two per question and phrase them about the person's own experience ("What made you pick that app?"), never leading.

**Don't** show the full transcript inline, auto-play audio, or hide the typed-answer option.
