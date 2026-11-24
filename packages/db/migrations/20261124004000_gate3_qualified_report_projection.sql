-- A source version changes whenever the redacted text changes. The version is
-- an opaque publication identity, not a content hash or a raw-text reference.
alter table public.transcripts add column redacted_source_version uuid not null default gen_random_uuid();
alter table public.evidence_quotes add column source_version uuid;
alter table public.reports add column qualified_summary_json jsonb
    check (qualified_summary_json is null or jsonb_typeof(qualified_summary_json) = 'object');
alter table public.reports add column qualified_policy_digest text
    check (qualified_policy_digest ~ '^[0-9a-f]{64}$');
alter table public.reports add column qualified_qualification_digest text
    check (qualified_qualification_digest ~ '^[0-9a-f]{64}$');
alter table public.findings add column qualified_claim text
    check (qualified_claim is null or btrim(qualified_claim) <> '');

create function internal.rotate_redacted_source_version() returns trigger
language plpgsql set search_path = '' as $$
begin
    if new.redacted_text is distinct from old.redacted_text then
        new.redacted_source_version := gen_random_uuid();
    elsif new.redacted_source_version is distinct from old.redacted_source_version then
        raise check_violation;
    end if;
    return new;
end;
$$;
revoke all on function internal.rotate_redacted_source_version() from public, anon, authenticated, service_role;
create trigger rotate_redacted_source_version before update on public.transcripts
    for each row execute function internal.rotate_redacted_source_version();

create function internal.gate3_policy_qualified(policy text, receipt text) returns boolean
language sql stable security definer set search_path = pg_catalog as $$
    select exists (select 1 from internal.gate1_redaction_policies as active
        where active.policy_digest = policy and active.qualification_digest = receipt
            and active.revoked_at is null);
$$;
create function internal.gate3_quote_current(target uuid) returns boolean
language sql stable security definer set search_path = pg_catalog as $$
    select exists (
        select 1 from public.evidence_quotes as quote
        join public.transcripts as source on source.id = quote.transcript_id
            and source.study_id = quote.study_id
        join internal.gate1_answer_jobs as job on job.answer_id = source.answer_id
        join internal.gate1_redaction_policies as policy
            on policy.policy_digest = job.publication_policy_digest
        where quote.id = target and quote.source_version = source.redacted_source_version
            and job.result_status = 'published'
            and policy.revoked_at is null
            and policy.qualification_digest = job.publication_qualification_digest
            and quote.end_char <= char_length(source.redacted_text)
            and quote.text = substring(source.redacted_text
                from quote.start_char + 1 for quote.end_char - quote.start_char)
            and internal.researches_transcript(source.id)
    );
$$;
create function internal.gate3_report_current(target uuid) returns boolean
language sql stable security definer set search_path = pg_catalog as $$
    select exists (
        select 1 from public.reports as report
        where report.id = target and report.qualified_summary_json is not null
            and internal.researches_study(report.study_id)
            and internal.gate3_policy_qualified(
                report.qualified_policy_digest, report.qualified_qualification_digest)
            and exists (select 1 from public.findings as finding
                join public.evidence_quotes as quote on quote.finding_id = finding.id
                where finding.report_id = report.id and finding.qualified_claim is not null
                    and internal.gate3_quote_current(quote.id))
            and not exists (select 1 from public.findings as finding
                left join public.evidence_quotes as quote on quote.finding_id = finding.id
                left join public.transcripts as source on source.id = quote.transcript_id
                left join internal.gate1_answer_jobs as job on job.answer_id = source.answer_id
                where finding.report_id = report.id and (finding.qualified_claim is null
                    or quote.id is null or not internal.gate3_quote_current(quote.id)
                    or job.publication_policy_digest is distinct from report.qualified_policy_digest
                    or job.publication_qualification_digest is distinct from report.qualified_qualification_digest))
    );
$$;
revoke all on function internal.gate3_policy_qualified(text, text),
    internal.gate3_quote_current(uuid), internal.gate3_report_current(uuid)
    from public, anon, authenticated, service_role;
grant execute on function internal.gate3_policy_qualified(text, text),
    internal.gate3_quote_current(uuid), internal.gate3_report_current(uuid) to authenticated;

-- A raw model claim must never be reachable via public.findings or the view.
revoke select (claim) on public.findings from authenticated;
grant select (qualified_claim) on public.findings to authenticated;
grant select (qualified_summary_json) on public.reports to authenticated;
grant select (redacted_source_version) on public.transcripts to authenticated;
grant select (source_version) on public.evidence_quotes to authenticated;
drop policy tenant_report on public.reports;
create policy tenant_report on public.reports for select to authenticated
    using (internal.gate3_report_current(id));
drop policy tenant_finding on public.findings;
create policy tenant_finding on public.findings for select to authenticated
    using (internal.gate3_report_current(report_id));
drop policy consented_tenant_quote on public.evidence_quotes;
create policy consented_tenant_quote on public.evidence_quotes for select to authenticated
    using (internal.gate3_quote_current(id) and exists (
        select 1 from public.findings as finding
        where finding.id = finding_id and internal.gate3_report_current(finding.report_id)
    ));

create or replace view research.reports with (security_invoker = true) as
    select id, study_id, version, state, created_at, updated_at,
        qualified_summary_json as summary_json from public.reports;
create or replace view research.findings with (security_invoker = true) as
    select id, study_id, report_id, position, qualified_claim as claim,
        count, total, confidence from public.findings;
create or replace view research.transcripts with (security_invoker = true) as
    select id, study_id, answer_id, redacted_text, created_at,
        redacted_source_version as source_version from public.transcripts;
create or replace view research.evidence_quotes with (security_invoker = true) as
    select q.id, q.study_id, q.finding_id, q.transcript_id, q.start_char, q.end_char,
        substring(t.redacted_text from q.start_char + 1 for q.end_char - q.start_char) as text,
        q.source_version
    from public.evidence_quotes as q
    join public.transcripts as t on t.id = q.transcript_id;
