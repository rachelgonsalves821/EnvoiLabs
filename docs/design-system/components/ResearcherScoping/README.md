# ResearcherScoping

The researcher's first screen, a conversation with the agent on the left and the study brief building itself on the right.

This is a showcase of how the components combine. Build it from AgentChat, StudyBrief, StatusChip and Button.

Layout rules
- Three columns at 1280px: a 232px study rail, the chat column, and a 440px brief panel. At 1024px the rail collapses to icons. Under 900px the brief becomes a sheet opened from a "View brief" button.
- The chat column keeps a 620px reading width for agent messages.
- The brief shows every section from the start as a dashed placeholder that says what comes next, so the researcher knows how close they are to a quote.
- The quote and the "Approve and pay" button appear only when the brief is complete.

The researcher app's one loud moment is the agent's Echo. Primary actions are `ink`.
