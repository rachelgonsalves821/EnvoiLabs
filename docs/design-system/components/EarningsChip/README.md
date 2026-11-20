# EarningsChip

The lime pill that tells a respondent what they will earn, paired with the question progress track.

The consumer provides the amount (formatted currency string), the current step and the total steps.

- `ev-earn` sits top right on every interview screen. It shows the reward for this interview, not lifetime earnings.
- `ev-progress` sits top left. Done steps are `ink`, the current step is a longer `pulse` segment, the rest are `line`. Always pair it with the text "3 of 7".
- Lifetime totals, points and streaks use `ev-chip-zest` and plain `ev-chip` on the profile and payout screens.

**Do** use `zest` only for money and points. Count the amount up over 700ms on the payout screen, once.

**Don't** show points without their cash value (100 points equals $1). Don't take earned money away for a broken streak, and never show a streak as at risk.
