# RespondentInterview

The core respondent screen, one interview question answered by voice on a phone.

This is a showcase of how the components combine. Build it from EarningsChip (progress and reward), the Echo as the record button, VoiceAnswer for follow-ups and the ghost Button for "Type instead".

Layout rules
- Full height with `100dvh` and safe-area padding. No scrolling on a 667px-tall phone.
- Question block starts `space-8` below the top bar, left-aligned, max 4 lines of `display-l` (32px on phones).
- The Echo sits in the bottom third, centered horizontally, 200px.
- The page has exactly one loud element, the Echo. No pulse buttons on this screen.

States
- Ready: Echo `idle`, label "Tap and talk like you'd tell a friend".
- Recording: Echo `listen`, "Recording" status with timer, haptic tick on start where supported.
- Saving: Echo `sent`, label "Got it".
- Follow-up: Echo `think` while the agent writes, then the probe appears as a VoiceAnswer follow-up.
- Error: "We couldn't hear that one. Tap to try again, or type instead."
