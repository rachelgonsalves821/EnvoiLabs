# Envoi Labs

Voice-first customer research for founders. Researchers scope studies, recruit from the respondent panel and receive findings linked to interview evidence. Respondents complete short interviews from their phones.

Researchers pay $1 per core question per respondent. Live follow-up questions and screeners are included.

- [Product requirements](docs/PRD.md)
- [Build plan](docs/BUILD_PLAN.md)
- [Agent kickoff](docs/KICKOFF.md)
- [Design reference](docs/design-system/README.md)

## Local development

Use Node.js 24 and pnpm 9.15.4. Install dependencies and start the web app from the repository root.

```sh
pnpm install
pnpm dev
```

Run `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` before opening a pull request.

## Auth configuration

Copy `apps/web/.env.example` to the deployment's environment configuration. Use the
environment's exact app origin. The example supports local HTTP only. Keep the
service role and phone data keys server-only. Generate the phone data key from
32 random bytes and store it unchanged across deployments because it protects
phone lookup and encryption. Apply the identity and provisioning migrations
before enabling application signup.

Enable Phone with Twilio Verify in Supabase Auth and use six-digit codes. Configure
the project's SMS rate limit and delivery settings before enabling real sends.
Enable TOTP enrollment and verification for researcher email accounts. Use a
trusted provisioning process to create each researcher Auth identity and its
organization membership and record its accepted terms. Configure the Supabase
magic link template using [the tested email template](packages/db/templates/magic-link.html)
and allow-list `/api/researcher/auth/callback` on each deployed app origin.

Run `pnpm --filter @envoi-labs/web test` for auth handler fixtures. Test runs
mock the provider and do not send SMS or email.

### Auth smoke tests on disposable local Supabase

The regular browser tests check public onboarding and fail-closed workspace access without configured providers. For the live local flow, use the [Supabase local Auth test configuration](https://supabase.com/docs/guides/auth/testing-auth-flows) with a disposable project and the repository's database migrations. Enable phone signup and confirmations, add the local test OTP `12025550142 = "012345"`, and enable TOTP enrollment and verification. Use the documented dummy SMS provider settings. The researcher test requests a link on the sign-in screen, opens the message captured by the local Mailpit server, then completes TOTP. No email leaves the disposable stack.

With Docker and the pinned Supabase CLI available, run `pnpm build` and `bash packages/db/scripts/test-local-auth.sh` from the repository root. The script creates a disposable stack, installs the email template, supplies local test keys and removes the stack on exit.

A hosted preview requires its own Supabase project and applied migrations, a server-only service role key and phone data key, its exact app origin and redirect allow-list, a configured email sender and SMS provider, and a provisioned researcher account with recorded terms. Keep local test phone mappings and dummy provider credentials out of hosted environments.
