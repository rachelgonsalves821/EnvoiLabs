# StudyBrief

The live one-page brief that fills in beside the scoping chat and ends in the quote, the right half of the scoping screen.

The consumer provides the brief object (title, decision, hypotheses, must-have and nice-to-have criteria, exclusions, sample size, length), the computed quote lines, the feasibility estimate and the approve handler.

- Sections appear in the order the agent asks, so the researcher watches it build. A new section enters with opacity and an 8px rise over 200ms, once.
- Must-haves are `ev-chip-ink`, nice-to-haves `ev-chip-outline`. Criteria are written as behavior ("Ordered food after 10pm in the last 30 days"), not identity labels.
- The quote shows the total in `stat`, the formula's line items beneath, then feasibility with a `good` or `warn` icon. Prices come from the pricing formula, never from the agent.
- The approve button repeats the amount ("Approve and pay $600").

**Don't** let the brief change without a caption in the chat saying what changed, or show a quote before feasibility is known.
