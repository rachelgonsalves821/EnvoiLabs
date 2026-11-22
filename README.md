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

Copy `apps/web/.env.example` to the deployment's environment configuration. Set the exact app origin and keep the service role key and other server secrets private. Apply the identity and provisioning migrations before enabling application signup.

Enable email sign-in and confirmation in Supabase Auth. Allow-list the exact app origin plus `/api/respondent/auth/callback` and `/api/researcher/auth/callback`. For the provider's standard one-time link, open the email in the browser that requested it. If using a custom email template, preserve the correct redirect for each role and test both paths through delivered email.

Enable TOTP enrollment and verification for researchers. Use a trusted provisioning process to create the researcher Auth identity, add organization membership and record accepted terms. Keep the respondent and researcher test identities distinct.

Supabase's built-in sender can deliver to authorized internal test addresses and has a shared project rate limit. Configure [custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp) and verify delivery to a controlled external inbox before recruiting respondents.

Run `pnpm --filter @envoi-labs/web test` for auth handler fixtures.

### Auth smoke tests on disposable local Supabase

The regular browser tests exercise public onboarding and fail-closed workspace access. For delivered email tests, start disposable local Supabase with email confirmations and researcher TOTP enabled. Tests request links through the respective app forms and open the messages captured by Mailpit. Use separate browser sessions and addresses for respondents and researchers.

With Docker and the pinned Supabase CLI available, run `pnpm build` and `bash packages/db/scripts/test-local-auth.sh` from the repository root. The script creates a disposable stack, supplies local test keys and removes the stack on exit.

### Verify sign-in on the hosted preview

Platform owns this Gate 0 check for R-RESP-01 and R-RSCH-01. Use a dedicated Vercel preview and Supabase preview project. Use distinct, controlled mailboxes with real delivery available for each role.

1. Match the Vercel deployment to the Git commit under test. Confirm that the Preview environment uses the dedicated Supabase project and that its migration history includes that commit's migrations. Set the [app environment variables](apps/web/.env.example) on the preview with the exact HTTPS origin and no trailing slash.
2. Check email delivery settings and allow-list the exact preview origin plus `/api/respondent/auth/callback` and `/api/researcher/auth/callback`. Confirm TOTP is enabled. Provision the researcher in a test organization with accepted terms.
3. **Respondent email.** In a fresh browser session, open `/r/signup`. An adult tester enters the controlled respondent email address, affirms the age attestation and requests a sign-in link. Open the delivered link in the requesting browser. Confirm that the protected `/r/status` page opens. Use trusted database access to verify a respondent account with an age-attestation timestamp.
4. **Researcher email and TOTP.** In a separate session, open `/app` and confirm the redirect to sign-in. Request a link for the provisioned researcher mailbox and open the delivered link. Navigate directly to `/app` before MFA and confirm the workspace remains locked. Complete MFA with the tester's authenticator and confirm the “New study” heading at `/app`.
5. Append the UTC verification time, deployed commit, preview deployment link and preview project identifier to [STATUS](docs/STATUS.md). Record the two email delivery outcomes separately, along with respondent account provisioning and age attestation, and researcher access before and after MFA. Link the passing CI runs for the tested code. Keep test addresses, links, codes, setup keys, callback query strings, tokens and cookies out of the record.

After both hosted journeys pass, review the remaining [Gate 0 criteria](docs/BUILD_PLAN.md) and [debt register](docs/DEBT.md) before recording delegated sign-off on [goal #4](https://github.com/rachelgonsalves821/EnvoiLabs/issues/4).

## Scheduled Gate 1 interview expiry

The signed Inngest endpoint `/api/inngest` is disabled by default. The expiry job runs on a five-minute UTC schedule, with the scheduled event timestamp as its database cutoff. Repeated execution of the same cutoff updates each due offer or unfinished interview once. The job returns only counts.

For the dedicated Vercel Preview branch or intentional Production environment, scope `ENVOI_GATE1_EXPIRY_ENABLED=1` and the environment's `INNGEST_SIGNING_KEY` to that target. Point `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` at the same target's Supabase database and apply `20261121221500_expire_gate1_interviews.sql`. Keep `INNGEST_DEV` unset on Vercel. Sync `/api/inngest` to the matching Inngest environment and confirm `gate1-expire-interviews` is registered with `*/5 * * * *`. For protected previews, use the Inngest Vercel integration's deployment protection key field if available. [Inngest Vercel setup](https://www.inngest.com/docs/durable-execution/deploying-functions/platforms/vercel)

To exercise local scheduling, set `ENVOI_GATE1_EXPIRY_ENABLED=1` and `INNGEST_DEV=1` for Next development. Use a disposable Supabase instance on loopback and bind the app to `127.0.0.1`. Run the Inngest Dev Server with `inngest dev -u http://127.0.0.1:3000/api/inngest`, then verify the registered function and a scheduled run. [Local Dev Server](https://www.inngest.com/docs/local-development)
