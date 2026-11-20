# InviteCard

The offer a respondent sees before accepting a study, built so the decision takes three seconds.

The consumer provides the topic, reward, minutes, question count, time left, a one-line "why you" drawn from the respondent's profile, and the two handlers.

Order of information is fixed: time left, topic, then the three facts (money in `zest-deep`, minutes, questions), then "why you", then the privacy line, then actions. The topic is written as the respondent would say it ("How you shop for snacks late at night"), never the researcher's internal study name.

- Container is `ev-float` (`radius-lg`, `shadow-card`).
- Primary action is the pulse button "Start answering". Secondary is "Not for me", which never penalizes.
- Under 2 hours left, the chip switches to "Ends in 2 h" with the `warn` icon.
- On mobile it slides up as a bottom sheet from the invite link, 320ms on the sheet curve.

**Don't** hide the reward below the fold, call it a "survey", or show the researcher's company name unless they chose to share it.
