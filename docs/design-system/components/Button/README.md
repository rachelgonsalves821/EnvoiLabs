# Button

Pill-shaped buttons in four variants, verb first and sentence case.

The consumer provides the label, an optional leading Phosphor icon (20px) and the variant class on a native `<button>`.

| Variant | Class | Use |
| --- | --- | --- |
| Primary | `ev-btn ev-btn-primary` | The main action in the researcher app ("Launch study", "Approve brief"). `ink` fill, `on-ink` text. |
| Pulse | `ev-btn ev-btn-pulse` | The one respondent-side go action ("Start answering", "Claim $7"). `pulse` fill, `on-pulse` text, `pulse-edge` border. At most one per view, never beside the Echo. |
| Secondary | `ev-btn ev-btn-secondary` | Everything else that matters. `paper` fill, `line-strong` border. |
| Ghost | `ev-btn ev-btn-ghost` | Low-stakes escapes like "Type instead" or "Skip". |

Add `ev-btn-sm` for 36px dense rows in the researcher app. Respondent buttons stay at 44px or taller.

**Do** write what happens ("Send answer", "Get my gift card"). Keep the label the same through the flow, so "Launch study" leads to "Study launched".

**Don't** append arrows to labels, use pulse for destructive actions, or put two primary buttons side by side.

Press feedback is `scale(0.97)` over 140ms. Disabled buttons drop to 45% opacity and explain why nearby.
