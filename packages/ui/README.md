# ui

Design tokens, shared components and the Echo.

Import shared components from `@envoi-labs/ui` and their stylesheet from `@envoi-labs/ui/styles.css`.
To apply the dark palette, set `data-theme="dark"` on the document element so portals inherit it.

Run `pnpm --filter @envoi-labs/ui gen:tokens` after updating `tokens/tokens.json` from the design-system export. The UI test task checks whether the generated stylesheet is current.
