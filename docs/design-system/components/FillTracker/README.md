# FillTracker

The live progress card on a launched study, showing how far fieldwork has come and whether it will fill on time.

The consumer provides the target, invited, accepted, completed and removed counts, the projected finish and segment counts.

- The headline is completes against target in `stat` ("14 of 20"), never a percentage.
- Bars share one scale. Invited is full width, the others are proportional, and the completed bar is the single `pulse` element on the page. When a count changes the bar grows over 600ms on `ease-out`.
- The status chip reads `good` ("On track for 36 h") or `warn` ("Slow, adding invites").
- Removals are always visible with the reason and "replaced free", so quality work builds trust instead of hiding.

**Don't** use a donut or gauge, show percentages below 30 completes, or hide removed responses.
