-- The trusted publisher is the only service path that can write qualified
-- report fields. Its immutable receipt binds the exact stored output.
create table pii.gate3_report_publications (
    id uuid primary key default gen_random_uuid(),
    report_id uuid not null unique references public.reports (id),
    content_digest text not null check (content_digest ~ '^[0-9a-f]{64}$'),
    policy_digest text not null check (policy_digest ~ '^[0-9a-f]{64}$'),
    qualification_digest text not null check (qualification_digest ~ '^[0-9a-f]{64}$'),
    published_at timestamptz not null default now()
);
alter table pii.gate3_report_publications enable row level security;
revoke all on pii.gate3_report_publications from public, anon, authenticated, service_role;
grant select on pii.gate3_report_publications to service_role;
create trigger immutable_gate3_publication before update or delete on pii.gate3_report_publications
    for each row execute function internal.reject_gate2_ledger_mutation();

create function internal.gate3_report_content_digest(target uuid) returns text
language sql stable security definer set search_path = pg_catalog as $$
    select encode(sha256(convert_to(report.qualified_summary_json::text || E'\n' ||
        coalesce((select string_agg(finding.id::text || ':' || finding.qualified_claim,
            E'\n' order by finding.id) from public.findings as finding
            where finding.report_id = report.id), ''), 'UTF8')), 'hex')
    from public.reports as report where report.id = target;
$$;
revoke all on function internal.gate3_report_content_digest(uuid)
    from public, anon, authenticated, service_role;

create function internal.gate3_source_current_for_publication(
    target uuid, supplied_policy text, supplied_qualification text
) returns boolean language sql stable security definer set search_path = pg_catalog as $$
    select exists (select 1 from public.evidence_quotes as quote
        join public.transcripts as source on source.id = quote.transcript_id
            and source.study_id = quote.study_id
        join public.answers as answer on answer.id = source.answer_id
        join public.sessions as interview on interview.id = answer.session_id
        join public.invites as invite on invite.id = interview.invite_id
        join public.respondents as respondent on respondent.id = invite.respondent_id
        join internal.gate1_answer_jobs as job on job.answer_id = answer.id
        where quote.id = target and respondent.status <> 'deleted'
            and internal.gate1_consent(respondent.id, source.study_id, 'researcher_access')
            and quote.source_version = source.redacted_source_version
            and quote.end_char <= char_length(source.redacted_text)
            and quote.text = substring(source.redacted_text
                from quote.start_char + 1 for quote.end_char - quote.start_char)
            and job.result_status = 'published'
            and job.publication_policy_digest = supplied_policy
            and job.publication_qualification_digest = supplied_qualification
            and internal.gate3_policy_qualified(supplied_policy, supplied_qualification)
            and exists (select 1 from internal.gate1_processing_input(answer.id) as item
                where item.source_hash = job.source_hash
                    and item.processing_revision = job.processing_revision
                    and item.publication_revision = job.publication_revision));
$$;
revoke all on function internal.gate3_source_current_for_publication(uuid, text, text)
    from public, anon, authenticated, service_role;

create function public.publish_gate3_qualified_report(
    supplied_report_id uuid, supplied_summary jsonb, supplied_claims jsonb,
    supplied_policy text, supplied_qualification text
) returns boolean language plpgsql security definer set search_path = '' as $$
declare
    target public.reports%rowtype;
    finding_count integer;
begin
    select * into target from public.reports where id = supplied_report_id for update;
    if not found or target.state <> 'ready'
        or jsonb_typeof(supplied_summary) <> 'object'
        or jsonb_typeof(supplied_claims) <> 'object'
        or not internal.gate3_policy_qualified(supplied_policy, supplied_qualification)
        or exists (select 1 from pii.gate3_report_publications where report_id = supplied_report_id)
    then return false; end if;
    select count(*) into finding_count from public.findings where report_id = target.id;
    if finding_count = 0 or finding_count <> (
        select count(*) from jsonb_each_text(supplied_claims))
        or exists (select 1 from public.findings as finding
            where finding.report_id = target.id and (
                nullif(btrim(supplied_claims ->> finding.id::text), '') is null
                or not exists (select 1 from public.evidence_quotes as quote
                    join public.transcripts as source on source.id = quote.transcript_id
                    join internal.gate1_answer_jobs as job on job.answer_id = source.answer_id
                    where quote.finding_id = finding.id and internal.gate3_source_current_for_publication(
                        quote.id, supplied_policy, supplied_qualification)
                        and job.publication_policy_digest = supplied_policy
                        and job.publication_qualification_digest = supplied_qualification)
                or exists (select 1 from public.evidence_quotes as quote
                    where quote.finding_id = finding.id
                        and not internal.gate3_source_current_for_publication(
                            quote.id, supplied_policy, supplied_qualification))
            ))
    then return false; end if;
    update public.findings as finding
    set qualified_claim = supplied_claims ->> finding.id::text
    where finding.report_id = target.id;
    update public.reports set qualified_summary_json = supplied_summary,
        qualified_policy_digest = supplied_policy,
        qualified_qualification_digest = supplied_qualification
    where id = target.id;
    insert into pii.gate3_report_publications
        (report_id, content_digest, policy_digest, qualification_digest)
    values (target.id, internal.gate3_report_content_digest(target.id),
        supplied_policy, supplied_qualification);
    return true;
end;
$$;
revoke all on function public.publish_gate3_qualified_report(uuid, jsonb, jsonb, text, text)
    from public, anon, authenticated, service_role;
grant execute on function public.publish_gate3_qualified_report(uuid, jsonb, jsonb, text, text)
    to service_role;

-- The service can create private model rows, but cannot write the public
-- qualified columns except through the publisher above.
revoke insert, update on public.reports, public.findings from service_role;
grant insert (id, study_id, version, state, summary_json) on public.reports to service_role;
grant update (state, summary_json, updated_at) on public.reports to service_role;
grant insert (id, report_id, study_id, position, claim, count, total, confidence)
    on public.findings to service_role;
grant update (claim, count, total, confidence, updated_at) on public.findings to service_role;

create or replace function internal.gate3_report_current(target uuid) returns boolean
language sql stable security definer set search_path = pg_catalog as $$
    select exists (
        select 1 from public.reports as report
        join pii.gate3_report_publications as receipt on receipt.report_id = report.id
        where report.id = target and report.qualified_summary_json is not null
            and receipt.content_digest = internal.gate3_report_content_digest(report.id)
            and receipt.policy_digest = report.qualified_policy_digest
            and receipt.qualification_digest = report.qualified_qualification_digest
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
