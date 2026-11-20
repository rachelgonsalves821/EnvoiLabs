Envoi Labs turns a founder's question into real voices by tomorrow. The product has two faces built from one system. The **respondent app** is a mobile-first web app where students and everyday consumers answer short interviews by voice and get paid in gift cards. The **researcher app** is a desktop-first workspace where founders scope a study with an agent, watch it fill and read the findings.

The brand is clean and professional at its core, with one loud, playful object on top. That object is **the Echo**, a glossy 3D sound blob that breathes, listens and reacts to your voice. Everything else stays disciplined so the Echo can be the thing people remember.

Tagline "Real customers, before your next move."

## Principles

1. **Voice first.** The record action is the biggest, most pressable thing on any respondent screen. Typing is always available, never the default.
2. **One loud thing per view.** The Echo or a `pulse` fill, never both competing. Everything else is `ink` on `fog` and `paper`.
3. **Money is lime.** `zest` means earnings and nothing else, so respondents learn to find their money at a glance.
4. **Show the work.** Researchers see counts, quotes and quality scores behind every claim. No decorative charts, no stats without a source.
5. **Fun in the copy and the motion, calm in the layout.** Left-aligned, generous space, no card grids of identical tiles.

## The two apps

| | Respondent app | Researcher app |
| --- | --- | --- |
| Device | Phone first, 360 to 430px | Desktop first, 1280px, works at 1024px |
| Mood | Playful, quick, rewarding | Crisp, confident, evidence-led |
| Hero | The Echo as the record button | The scoping chat beside a live brief |
| Accent | `pulse` for record, `zest` for money | `ink` for actions, `tide` for data, `pulse` only for the agent and the one key action |
| Type | `display-l` questions, `body-l` text | `h1` and `h2` titles, `body` text |

## Content fundamentals

- **Voice.** Warm, direct, a little cheeky with respondents. Plain and exact with researchers. Second person (you, your). Envoi speaks as "we" only in legal and payout copy.
- **Casing.** Sentence case everywhere, buttons included. No all-caps labels, no tracked eyebrows.
- **Punctuation.** No em dashes. No exclamation marks except the payout moment ("$7 is on its way!"). Curly quotes, the real ellipsis character.
- **Numbers.** Always concrete. "8 minutes, $7" beats "a short survey". Use tabular numbers for money and counts.
- **Emoji.** None in the UI. People can use them in their answers.

Real copy, respondent side

- Invite title "Your snack habits, 8 min, $7"
- Record prompt "Tap and talk like you'd tell a friend"
- Nudge "You're 3 of 7 in. $7 is waiting when you finish."
- Error "We couldn't hear that one. Tap to try again, or type instead."
- Privacy line "Researchers never see your name or number."

Real copy, researcher side

- Empty state "What decision are you trying to make? Start there and I'll draft the study."
- Feasibility "We expect 18 of your 30 in 48 hours."
- Finding label "11 of 30 said this"
- Honest label "Directional qualitative. Student convenience sample."

## Visual foundations

**Color.** Pages sit on `fog`, content on `paper`, wells on `paper-sunk`. Text is `ink`, secondary text `ink-muted`. `pulse` is the Envoi pink for the Echo and the single most important action. Text on a pulse fill is `on-pulse`, and a pulse fill on `fog` gets a 1px `pulse-edge` border so its shape clears 3:1. Pink as text is always `pulse-edge`. `zest` is reserved for money. `tide` is the researcher's data color. Status uses `good`, `warn` and `critical`, each with a word or icon.

**Type.** One family, Manrope, from Google Fonts (weights 400 to 800). Elegance comes from tight tracking and weight contrast, not a second face. Headlines (`display-xl`, `display-l`, `h1`, `stat`) are 700 with negative tracking, `h2` is 650, and reading text (`h3`, `body-l`, `body`, `body-s`, `label`, `caption`) is 400 to 600 at default tracking. Keep lines under 70 characters. Use `text-wrap: balance` on headings and `font-variant-numeric: tabular-nums` on money and counts.

**Spacing.** The scale is `space-1` to `space-16` on a 4px base. Mobile pages use `space-4` gutters, desktop `space-6`. Vary rhythm on purpose, tight inside a group and wide between groups.

**Shape.** Buttons and chips are pills (`radius-pill`). Cards are `radius-md`. The invite card, sheets and the interview stage are `radius-lg`. Inputs are `radius-sm`.

**Depth.** Most surfaces are flat with a `line` edge. Only floating things get `shadow-card`. Pressable fills get `shadow-press` so they feel like objects beside the 3D Echo. No glassmorphism, no glow halos.

**Focus.** Every interactive element shows a 2px solid `focus` outline with a 2px offset on keyboard focus. Never remove it.

## The Echo (3D)

The Echo is a WebGL sphere whose surface is displaced by smooth noise, lit like soft glossy plastic. Its body is `pulse`, with a peach highlight and a cool lilac rim from the light. It is a material, not a decorative gradient, and it appears once per view at most.

| State | Where | Behavior |
| --- | --- | --- |
| Idle | Respondent question screen | Slow breathing, 6s loop, gentle surface drift |
| Listening | While recording | Surface ripples driven by mic level, scales to 1.06 |
| Thinking | Agent writing a follow-up | Faster, tighter wobble, no scale change |
| Sent | Answer saved | One settle back to round over 320ms, then idle |
| Agent | Researcher app | 40px Echo beside agent messages and on empty states |

Build it with three.js (or a single fragment shader) in production. Pause the render loop when off-screen or the tab is hidden. Under `prefers-reduced-motion`, render one still frame and show recording state with a pulse-wash ring instead of ripples. Always ship a static PNG fallback for devices without WebGL.

## Motion

Motion explains state. It is never decoration on scroll.

- Easing for entering and exiting is `cubic-bezier(0.23, 1, 0.32, 1)`. Movement on screen uses `cubic-bezier(0.77, 0, 0.175, 1)`. Sheets use `cubic-bezier(0.32, 0.72, 0, 1)`. Never ease-in on UI.
- Durations are 140ms for presses, 200ms for most UI, 320ms for sheets and the next question sliding in. Nothing interactive runs over 400ms.
- Pressables scale to 0.97 on press. Entrances start at scale 0.96 and opacity 0, never scale 0.
- Hover effects only under `(hover: hover) and (pointer: fine)`.
- Animate only transform and opacity.
- The payout moment is the one celebration. The Echo flashes `zest` once and the earnings chip counts up. No confetti.
- Under reduced motion keep opacity and color changes, drop movement.

## Layout

**Respondent.** One question per screen. Top bar holds progress on the left and the earnings chip on the right. The question sits in `display-l`, left-aligned. The Echo sits in the lower half within thumb reach, with "Type instead" beneath it. Respect safe areas and use `100dvh`, never `100vh`.

**Researcher.** A left rail for studies, the main column for the current task. Scoping is a two-column split, the agent chat on the left and the live brief on the right, which fills in as the conversation goes. Reports read top to bottom, the answer first, then themes, then evidence.

## Iconography

Use Phosphor Icons, Regular weight at 20px in UI and Bold at 24px on the respondent record controls. Stroke icons only, `ink` or `ink-muted`, never filled color tiles above headings. No icon sits above a heading as decoration. There is no logo yet, so set "Envoi" in Manrope 700 with `ink` and -0.045em tracking until a mark exists.

## Accessibility

- Text pairs in this system meet 4.5:1 in both themes, as each token's note states. `line-strong` borders and the `focus` ring clear 3:1.
- Every status color carries a word or icon. Good and critical also differ in lightness.
- Hit targets are 44px minimum, the record button 96px.
- Voice is never the only way in. Every question accepts typed answers.
- Live regions announce "Recording", "Saved" and new agent messages.

## Do and don't

- Do use one `pulse` moment per view. Don't put pulse on a heading or a long text run.
- Do keep `zest` for money. Don't use it for success states.
- Do left-align questions and findings. Don't center blocks of text.
- Don't use purple to blue gradients, gradient text, glass cards, colored left-border cards, monospace labels or all-caps eyebrows.
