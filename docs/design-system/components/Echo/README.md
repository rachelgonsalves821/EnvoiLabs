# Echo

The Echo is Envoi Labs's signature 3D object, a glossy pink sound blob that is the record button for respondents and the agent's presence for researchers.

Mount it with `EnvoiLabs.Echo(hostElement, { state, level })`. The consumer provides a square host element (96px minimum as a button, 160 to 240px as a hero, 40px beside agent messages), the `state` and, while recording, an optional `level()` function returning the mic level from 0 to 1 (an `AnalyserNode` RMS works). It returns `{ setState, destroy }`.

States are `idle`, `listen`, `think`, `sent` and `payout`. Switch state on real events only, never on a timer.

**When to use**
- As the record button on the respondent interview screen, wrapped in a `<button>` with an `aria-label` of "Start recording" or "Stop recording" and `aria-pressed`.
- Small, beside agent messages and on empty states in the researcher app.

**Do**
- Show at most one Echo per view.
- Keep `space-12` of clear space around a hero Echo.
- Pair the listening state with a visible "Recording" text label and a timer.

**Don't**
- Put text or icons on top of it.
- Recolor it per study or per brand. It is always `pulse` (and `zest` only in the payout flash).
- Use it as a loading spinner for ordinary waits.

**Behavior**
- Pauses its render loop when off-screen or the tab is hidden.
- Under `prefers-reduced-motion` it draws one still frame.
- Without WebGL it falls back to a flat pulse disc.
- Production can swap the fragment shader for a three.js mesh with the same states and palette.
