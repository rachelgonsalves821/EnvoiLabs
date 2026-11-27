-- A qualified summary is a projection of the locked findings, not an
-- independent set of claims and statistics. Keep this check in the trusted
-- publisher so a mismatched draft returns false without creating a receipt.
create function internal.gate3_summary_matches_findings(
    target uuid, supplied_summary jsonb, supplied_claims jsonb, supplied_quotes jsonb
) returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
    finding record;
    theme jsonb;
    summary_quotes jsonb;
    mapped_quotes jsonb;
    theme_count integer;
begin
    if jsonb_typeof(supplied_summary) is distinct from 'object'
        or supplied_summary -> 'version' is distinct from '2'::jsonb
        or jsonb_typeof(supplied_summary -> 'themes') is distinct from 'array'
    then return false; end if;

    theme_count := jsonb_array_length(supplied_summary -> 'themes');
    if theme_count = 0 or theme_count <> (
        select count(*) from public.findings where report_id = target
    ) then return false; end if;

    for finding in select id, position, count, total, confidence
        from public.findings where report_id = target
    loop
        if finding.position < 1 or finding.position > theme_count then return false; end if;
        theme := supplied_summary -> 'themes' -> (finding.position - 1);
        if jsonb_typeof(theme) is distinct from 'object'
            or theme -> 'claim' is distinct from to_jsonb(supplied_claims ->> finding.id::text)
            or theme -> 'count' is distinct from to_jsonb(finding.count)
            or theme -> 'total' is distinct from to_jsonb(finding.total)
            or theme -> 'confidence' is distinct from to_jsonb(finding.confidence)
            or jsonb_typeof(theme -> 'supportingQuotes') is distinct from 'array'
            or jsonb_typeof(theme -> 'contradictingQuotes') is distinct from 'array'
        then return false; end if;

        -- These are minimum confidence floors, shared with the report UI.
        -- Cross multiplication avoids floating point boundary differences.
        if finding.count < 1 or finding.total < 1 or finding.count > finding.total
            or (finding.confidence = 'high' and finding.count::numeric * 10 < finding.total::numeric * 6)
            or (finding.confidence = 'medium' and finding.count::numeric * 10 < finding.total::numeric * 3)
            or jsonb_array_length(theme -> 'supportingQuotes') = 0
        then return false; end if;

        select coalesce(jsonb_agg(identity order by identity::text), '[]'::jsonb)
        into summary_quotes from (
            select value - 'confidence' as identity
            from jsonb_array_elements((theme -> 'supportingQuotes') ||
                (theme -> 'contradictingQuotes')) as quote(value)
        ) as quote_identities;
        select coalesce(jsonb_agg(value order by value::text), '[]'::jsonb)
        into mapped_quotes from jsonb_array_elements(
            supplied_quotes -> finding.position::text) as quote(value);
        if summary_quotes is distinct from mapped_quotes then return false; end if;
    end loop;
    return true;
end;
$$;
revoke all on function internal.gate3_summary_matches_findings(uuid, jsonb, jsonb, jsonb)
    from public, anon, authenticated, service_role;

create or replace function public.publish_gate3_qualified_report(
    supplied_report_id uuid, supplied_summary jsonb, supplied_claims jsonb,
    supplied_quotes jsonb, supplied_policy text, supplied_qualification text
) returns boolean language plpgsql security definer set search_path = '' as $$
declare
    target public.reports%rowtype;
    finding_count integer;
begin
    select * into target from public.reports where id = supplied_report_id for update;
    if not found or target.state <> 'ready'
        or jsonb_typeof(supplied_summary) <> 'object'
        or jsonb_typeof(supplied_claims) <> 'object'
        or not internal.gate3_report_quotes_match(supplied_report_id, supplied_quotes)
        or not internal.gate3_summary_matches_findings(
            supplied_report_id, supplied_summary, supplied_claims, supplied_quotes)
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
revoke all on function public.publish_gate3_qualified_report(uuid, jsonb, jsonb, jsonb, text, text)
    from public, anon, authenticated, service_role;
