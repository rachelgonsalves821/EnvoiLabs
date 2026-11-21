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

With Docker and the pinned Supabase CLI available, run `pnpm build` and `bash packages/db/scripts/test-local-auth.sh` from the repository root. The script creates a disposable stack, supplies local test keys and removes the stack on exit. It uses the checked-in email template by default. Set `ENVOI_AUTH_TEST_LINK=pkce` to test the provider's default callback. CI exercises both.

### Verify sign-in on the hosted preview

Platform owns this Gate 0 check for R-RESP-01 and R-RSCH-01. Respondent phone authentication provisions a persistent web app account. The SMS carries the sign-in code. The signed-in Home and Earnings screens are delivered in Gates 1 and 2. Use a dedicated Vercel preview deployment, a dedicated Supabase preview project, and a phone and mailbox controlled by the testers. Keep the local OTP mapping, dummy provider credentials and disposable-stack script confined to local tests.

1. Match the Vercel deployment to the Git commit under test. Check that its Preview environment points to the dedicated Supabase project and that the project's migration history includes the migrations from that commit. Set the [app environment variables](apps/web/.env.example) on the preview, using the exact HTTPS origin without a trailing slash. Keep the phone data key stable and server-side.
2. Check that the preview project has a working SMS provider, a sender allowed to deliver to the test mailbox, and TOTP enrollment and verification enabled. For an eligible internal tester, the built-in Supabase sender can use the default link. Open it in the same browser session that requested it. When using custom SMTP, install the [magic-link template](packages/db/templates/magic-link.html). Allow-list the exact preview origin plus `/api/researcher/auth/callback`. Provision the researcher in a test organization with recorded terms acceptance.
3. **Respondent phone.** In a fresh browser session, open `/r/signup`. An adult tester enters the controlled phone number, affirms the age attestation and requests a code. Enter the code delivered by SMS. Confirm “Phone verified” and use the trusted preview database to confirm that the respondent account was provisioned with an age-attestation timestamp. Record the outcome without copying the number or the row.
4. **Researcher email and TOTP.** In a separate fresh session, open `/app` and confirm the redirect to sign-in. Request a link for the provisioned mailbox and open the delivered email link. Before completing MFA, navigate directly to `/app` again and confirm the workspace still requires MFA. For a new factor, use the displayed setup key in the tester's authenticator. Enter its current code and confirm the “New study” heading at `/app`.
5. Append the UTC verification time, deployed commit, preview deployment link, preview project identifier, and separate results for SMS delivery, attestation, email delivery, pre-MFA access and post-MFA workspace access to [STATUS](docs/STATUS.md). Link the passing CI runs for the tested code. Record the first failed step and its owner if a journey stops. Keep addresses, codes, setup keys, callback query strings, tokens and cookie values out of the record.

After both hosted journeys pass, review the remaining [Gate 0 criteria](docs/BUILD_PLAN.md) and [debt register](docs/DEBT.md) before recording delegated sign-off on [goal #4](https://github.com/rachelgonsalves821/EnvoiLabs/issues/4).
