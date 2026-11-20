# StatusChip

Small pills for state, criteria and labels, always a word with an optional icon.

The consumer provides the text and a tone class.

| Tone | Class | Meaning |
| --- | --- | --- |
| Good | `ev-chip ev-chip-good` | Quality passed, quota filled. Icon in `good`. |
| Warn | `ev-chip ev-chip-warn` | Expiring soon, slow fill, needs review. Icon in `warn`. |
| Critical | `ev-chip ev-chip-critical` | Removed response, payment failed. Icon in `critical`. |
| Segment | `ev-chip ev-chip-tide` | A respondent segment or data series. |
| Must have | `ev-chip ev-chip-ink` | A hard screening criterion in the brief. |
| Nice to have | `ev-chip ev-chip-outline` | A soft criterion. |
| Recording | `ev-chip ev-chip-pulse` | Live recording state, paired with the Echo. |
| Neutral | `ev-chip` | Labels such as "Directional qualitative". |

Text in chips is always `ink` on a light ground so it stays legible. Color sits in the icon only, so status never depends on hue alone.
