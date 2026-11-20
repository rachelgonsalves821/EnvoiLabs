# AgentChat

The scoping conversation between a researcher and the Envoi agent, the left half of the scoping screen.

The consumer provides the message list (author, text, optional quick-reply options) and the send handler.

- **Researcher messages** sit right-aligned on `paper-sunk`.
- **Agent messages** sit left with a 36px Echo as the avatar. The Echo is in `think` while the agent writes and `idle` after.
- **Quick replies** are toggle pills (`aria-pressed`) so the researcher can answer with one tap. Selected uses `pulse-wash` with a `pulse-edge` border. Always include "Something else".
- **Composer** is a 2-line textarea with a round `ink` send button. Placeholder invites pasting existing questions.
- After each answer, a `caption` line says what changed in the brief ("I'll add this to your brief as the decision"), so the right panel never updates silently.

The agent asks one question at a time, in this order: the decision, hypotheses, who to talk to (must have vs. nice to have), exclusions, how many, stimulus, deadline. When a goal implies sizing it pushes back plainly ("Interviews can't tell you what share of students would pay. They can tell you why and at what price it feels fair").

**Don't** stream long walls of text, ask several questions in one message, or put prices in chat before the brief is approved.
