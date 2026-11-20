# db

Schema, migrations, seed data and typed queries.

Run `bash packages/db/scripts/test-local.sh` from the repository root with
Docker running and the Supabase CLI available. The runner applies migrations to
a fresh local database and runs the pgTAP tests. CI uses Supabase CLI 2.84.2.

The identity migration provisions read-only client access by verified auth
identity. Researchers need an MFA-verified session to read their own
membership and organization. Respondents can read their own identity row.
Account creation, membership changes and private phone data require a trusted
server write. The signup service still needs to supply authenticated
encryption and a keyed digest of the normalized phone number.
