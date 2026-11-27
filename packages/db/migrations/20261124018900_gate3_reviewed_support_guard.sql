-- Reviewer support is separate from model proposals and the ten public quotes.
-- A report version gets one immutable exact-source manifest per finding.
create table pii.gate3_reviewed_support_manifests (
    report_id uuid not null references public.reports (id),
    finding_id uuid not null references public.findings (id),
    actor_auth_user_id uuid not null,
    causation_id uuid not null,
    sources_json jsonb not null check (jsonb_typeof(sources_json) = 'array'
        and jsonb_array_length(sources_json) between 1 and 500),
    attested_at timestamptz not null default clock_timestamp(),
    primary key (report_id, finding_id),
    unique (causation_id)
);
alter table pii.gate3_reviewed_support_manifests enable row level security;
revoke all on pii.gate3_reviewed_support_manifests
    from public, anon, authenticated, service_role;
create trigger immutable_gate3_reviewed_support
before update or delete on pii.gate3_reviewed_support_manifests
for each row execute function internal.reject_gate2_ledger_mutation();

create function public.attest_gate3_reviewed_support(
    supplied_report_id uuid, supplied_finding_id uuid,
    supplied_actor_auth_user_id uuid, supplied_causation_id uuid,
    supplied_sources jsonb
) returns boolean language plpgsql security definer set search_path = '' as $$
declare
    target public.reports%rowtype;
    item jsonb;
    prior pii.gate3_reviewed_support_manifests%rowtype;
    source_id uuid;
    version_id uuid;
begin
    select * into target from public.reports where id = supplied_report_id for update;
    if not found or target.state <> 'ready' or supplied_causation_id is null
        or supplied_actor_auth_user_id is null
        or jsonb_typeof(supplied_sources) <> 'array'
        or jsonb_array_length(supplied_sources) not between 1 and 500
        or not exists (select 1 from public.findings
            where id = supplied_finding_id and report_id = target.id
                and study_id = target.study_id)
        or not exists (select 1 from public.researchers as researcher
            join public.studies as study
                on study.organization_id = researcher.organization_id
            where study.id = target.study_id
                and researcher.auth_user_id = supplied_actor_auth_user_id)
    then return false; end if;

    select * into prior from pii.gate3_reviewed_support_manifests
    where report_id = target.id and finding_id = supplied_finding_id;
    if found then return prior.actor_auth_user_id = supplied_actor_auth_user_id
        and prior.causation_id = supplied_causation_id
        and prior.sources_json = supplied_sources; end if;
    if exists (select 1 from pii.gate3_report_publications
        where report_id = target.id) then return false; end if;
    if exists (select 1 from pii.gate3_reviewed_support_manifests
        where causation_id = supplied_causation_id) then return false; end if;

    for item in select value from jsonb_array_elements(supplied_sources) loop
        if jsonb_typeof(item) <> 'object'
            or (select count(*) from jsonb_object_keys(item)) <> 2
            or coalesce(item ->> 'transcriptId', '') !~*
                '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
            or coalesce(item ->> 'sourceVersion', '') !~*
                '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
        then return false; end if;
        source_id := (item ->> 'transcriptId')::uuid;
        version_id := (item ->> 'sourceVersion')::uuid;
        if not exists (select 1 from public.transcripts as source
            join public.answers as answer on answer.id = source.answer_id
            join public.sessions as interview on interview.id = answer.session_id
            join public.invites as offer on offer.id = interview.invite_id
            join public.respondents as respondent on respondent.id = offer.respondent_id
            join internal.gate1_answer_jobs as job on job.answer_id = answer.id
            where source.id = source_id and source.study_id = target.study_id
                and source.redacted_source_version = version_id
                and source.redacted_text is not null
                and interview.study_id = target.study_id
                and interview.state in ('approved', 'paid')
                and interview.submitted_at is not null
                and offer.study_id = target.study_id and offer.state = 'accepted'
                and respondent.status = 'active'
                and not exists (select 1 from public.removals as removal
                    where removal.session_id = interview.id)
                and exists (select 1 from public.quality_scores as quality
                    where quality.session_id = interview.id
                        and quality.decision = 'approve')
                and internal.gate1_consent(respondent.id,
                    target.study_id, 'researcher_access')
                and internal.gate1_consent(respondent.id,
                    target.study_id, 'retention')
                and job.result_status = 'published'
                and internal.gate3_policy_qualified(job.publication_policy_digest,
                    job.publication_qualification_digest)
                and exists (select 1 from internal.gate1_processing_input(answer.id) as input
                    where input.source_hash = job.source_hash
                        and input.processing_revision = job.processing_revision
                        and input.publication_revision = job.publication_revision))
        then return false; end if;
    end loop;
    if (select count(distinct item ->> 'transcriptId')
        from jsonb_array_elements(supplied_sources) as item)
        <> jsonb_array_length(supplied_sources)
    then return false; end if;

    insert into pii.gate3_reviewed_support_manifests
        (report_id, finding_id, actor_auth_user_id, causation_id, sources_json)
    values (target.id, supplied_finding_id, supplied_actor_auth_user_id,
        supplied_causation_id, supplied_sources);
    return true;
end;
$$;
revoke all on function public.attest_gate3_reviewed_support(
    uuid, uuid, uuid, uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.attest_gate3_reviewed_support(
    uuid, uuid, uuid, uuid, jsonb) to service_role;

-- Recompute ownership and qualification at publication and at every read.
-- Extra support rows may lift a count above the ten displayed quote limit,
-- but multiple transcripts from one respondent still count only once.
create function internal.gate3_reviewed_support_current(
    supplied_report_id uuid, supplied_policy text, supplied_qualification text
) returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
    target public.reports%rowtype;
    finding public.findings%rowtype;
    manifest pii.gate3_reviewed_support_manifests%rowtype;
    item jsonb;
    approved_count integer;
    manifest_count integer;
    supporter uuid;
    supporters uuid[];
begin
    select * into target from public.reports where id = supplied_report_id;
    if not found or not internal.gate3_policy_qualified(
        supplied_policy, supplied_qualification) then return false; end if;
    select count(distinct offer.respondent_id) into approved_count
    from public.sessions as interview
    join public.invites as offer on offer.id = interview.invite_id
    join public.respondents as respondent on respondent.id = offer.respondent_id
    join public.quality_scores as quality on quality.session_id = interview.id
    where interview.study_id = target.study_id
        and interview.state in ('approved', 'paid')
        and interview.submitted_at is not null
        and offer.study_id = target.study_id and offer.state = 'accepted'
        and quality.decision = 'approve' and respondent.status = 'active'
        and not exists (select 1 from public.removals as removal
            where removal.session_id = interview.id)
        and internal.gate1_consent(respondent.id, target.study_id, 'retention')
        and internal.gate1_consent(respondent.id, target.study_id, 'researcher_access');
    if approved_count < 10 then return false; end if;
    select count(*) into manifest_count
    from pii.gate3_reviewed_support_manifests where report_id = target.id;
    if manifest_count = 0 or manifest_count <> (
        select count(*) from public.findings where report_id = target.id)
    then return false; end if;

    for finding in select * from public.findings
        where report_id = target.id order by position loop
        select * into manifest from pii.gate3_reviewed_support_manifests
        where report_id = target.id and finding_id = finding.id;
        if not found or finding.total <> approved_count
            or exists (select 1 from public.evidence_quotes as quote
                where quote.finding_id = finding.id and not exists (
                    select 1 from jsonb_array_elements(manifest.sources_json) as source_ref
                    where source_ref ->> 'transcriptId' = quote.transcript_id::text
                        and source_ref ->> 'sourceVersion' = quote.source_version::text))
        then return false; end if;
        supporters := array[]::uuid[];
        for item in select value from jsonb_array_elements(manifest.sources_json) loop
            select respondent.id into supporter
            from public.transcripts as source
            join public.answers as answer on answer.id = source.answer_id
            join public.sessions as interview on interview.id = answer.session_id
            join public.invites as offer on offer.id = interview.invite_id
            join public.respondents as respondent on respondent.id = offer.respondent_id
            join public.quality_scores as quality on quality.session_id = interview.id
            join internal.gate1_answer_jobs as job on job.answer_id = answer.id
            where source.id = (item ->> 'transcriptId')::uuid
                and source.redacted_source_version = (item ->> 'sourceVersion')::uuid
                and source.study_id = target.study_id
                and source.redacted_text is not null
                and interview.study_id = target.study_id
                and interview.state in ('approved', 'paid')
                and interview.submitted_at is not null
                and offer.study_id = target.study_id and offer.state = 'accepted'
                and respondent.status = 'active' and quality.decision = 'approve'
                and not exists (select 1 from public.removals as removal
                    where removal.session_id = interview.id)
                and internal.gate1_consent(respondent.id,
                    target.study_id, 'retention')
                and internal.gate1_consent(respondent.id,
                    target.study_id, 'researcher_access')
                and job.result_status = 'published'
                and job.publication_policy_digest = supplied_policy
                and job.publication_qualification_digest = supplied_qualification
                and exists (select 1 from internal.gate1_processing_input(answer.id) as input
                    where input.source_hash = job.source_hash
                        and input.processing_revision = job.processing_revision
                        and input.publication_revision = job.publication_revision);
            if supporter is null then return false; end if;
            if not supporter = any(supporters) then
                supporters := array_append(supporters, supporter);
            end if;
        end loop;
        if coalesce(array_length(supporters, 1), 0) <> finding.count
            or finding.count > finding.total then return false; end if;
    end loop;
    return true;
end;
$$;
revoke all on function internal.gate3_reviewed_support_current(uuid, text, text)
    from public, anon, authenticated, service_role;

-- Only a separately provisioned qualifier may insert this receipt. The
-- application service role cannot manufacture approval for its own text.
-- The report stays unavailable until that qualifier handoff is implemented.
create table pii.gate3_public_text_qualifications (
    report_id uuid primary key references public.reports (id),
    payload_digest text not null check (payload_digest ~ '^[a-f0-9]{64}$'),
    policy_digest text not null check (policy_digest ~ '^[a-f0-9]{64}$'),
    qualification_digest text not null check (qualification_digest ~ '^[a-f0-9]{64}$'),
    qualifier_receipt_id uuid not null unique,
    qualified_at timestamptz not null default clock_timestamp()
);
alter table pii.gate3_public_text_qualifications enable row level security;
revoke all on pii.gate3_public_text_qualifications
    from public, anon, authenticated, service_role;
create trigger immutable_gate3_public_text_qualification
before update or delete on pii.gate3_public_text_qualifications
for each row execute function internal.reject_gate2_ledger_mutation();

create function internal.gate3_public_text_digest(
    supplied_summary jsonb, supplied_claims jsonb
) returns text language sql immutable set search_path = '' as $$
    select encode(extensions.digest(convert_to(jsonb_build_object(
        'summary', supplied_summary, 'claims', supplied_claims)::text,
        'UTF8'), 'sha256'), 'hex');
$$;
revoke all on function internal.gate3_public_text_digest(jsonb, jsonb)
    from public, anon, authenticated, service_role;

create function internal.gate3_public_text_current(
    supplied_report_id uuid, supplied_summary jsonb, supplied_claims jsonb,
    supplied_policy text, supplied_qualification text
) returns boolean language sql stable security definer set search_path = '' as $$
    select exists (select 1 from pii.gate3_public_text_qualifications as receipt
        where receipt.report_id = supplied_report_id
            and receipt.payload_digest = internal.gate3_public_text_digest(
                supplied_summary, supplied_claims)
            and receipt.policy_digest = supplied_policy
            and receipt.qualification_digest = supplied_qualification
            and internal.gate3_policy_qualified(
                receipt.policy_digest, receipt.qualification_digest));
$$;
revoke all on function internal.gate3_public_text_current(
    uuid, jsonb, jsonb, text, text)
    from public, anon, authenticated, service_role;

-- Keep the older publisher implementation private. Direct service callers
-- must pass the manifest guard before it can write a qualified report.
alter function public.publish_gate3_reviewed_report(
    uuid, jsonb, jsonb, jsonb, text, text, jsonb, jsonb)
    set schema internal;
alter function internal.publish_gate3_reviewed_report(
    uuid, jsonb, jsonb, jsonb, text, text, jsonb, jsonb)
    rename to publish_gate3_reviewed_report_unchecked;
revoke all on function internal.publish_gate3_reviewed_report_unchecked(
    uuid, jsonb, jsonb, jsonb, text, text, jsonb, jsonb)
    from public, anon, authenticated, service_role;

create function public.publish_gate3_reviewed_report(
    supplied_report_id uuid, supplied_summary jsonb, supplied_claims jsonb,
    supplied_quotes jsonb, supplied_policy text, supplied_qualification text,
    supplied_reviews jsonb, supplied_positions jsonb
) returns boolean language plpgsql security definer set search_path = '' as $$
declare target public.reports%rowtype;
begin
    select * into target from public.reports where id = supplied_report_id for update;
    if not found or not internal.gate3_reviewed_support_current(
        target.id, supplied_policy, supplied_qualification)
        or not internal.gate3_public_text_current(target.id, supplied_summary,
            supplied_claims, supplied_policy, supplied_qualification)
    then return false; end if;
    return internal.publish_gate3_reviewed_report_unchecked(
        supplied_report_id, supplied_summary, supplied_claims, supplied_quotes,
        supplied_policy, supplied_qualification, supplied_reviews, supplied_positions);
end;
$$;
revoke all on function public.publish_gate3_reviewed_report(
    uuid, jsonb, jsonb, jsonb, text, text, jsonb, jsonb)
    from public, anon, authenticated, service_role;
grant execute on function public.publish_gate3_reviewed_report(
    uuid, jsonb, jsonb, jsonb, text, text, jsonb, jsonb) to service_role;

-- Preserve the existing function OID used by researcher views and readers.
-- A withdrawn/re-redacted supporter invalidates the next direct read even
-- when that source was not one of the ten displayed quotes.
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
            and internal.gate3_reviewed_support_current(
                report.id, report.qualified_policy_digest,
                report.qualified_qualification_digest)
            and internal.gate3_public_text_current(report.id,
                report.qualified_summary_json,
                (select jsonb_object_agg(finding.id::text, finding.qualified_claim)
                    from public.findings as finding where finding.report_id = report.id),
                report.qualified_policy_digest,
                report.qualified_qualification_digest)
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

-- One private statement snapshot for Gate 3's final AI bridge recheck. It
-- contains identities only, never source text or private rationale.
create function public.read_gate3_reviewed_support_snapshot(supplied_report_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
    with target as (
        select id, study_id from public.reports where id = supplied_report_id
    ), approved as (
        select distinct respondent.id as respondent_id
        from target
        join public.sessions as interview on interview.study_id = target.study_id
        join public.invites as offer on offer.id = interview.invite_id
        join public.respondents as respondent on respondent.id = offer.respondent_id
        join public.quality_scores as quality on quality.session_id = interview.id
        where interview.state in ('approved', 'paid')
            and interview.submitted_at is not null
            and offer.study_id = target.study_id and offer.state = 'accepted'
            and quality.decision = 'approve' and respondent.status = 'active'
            and not exists (select 1 from public.removals as removal
                where removal.session_id = interview.id)
            and internal.gate1_consent(respondent.id, target.study_id, 'retention')
            and internal.gate1_consent(respondent.id,
                target.study_id, 'researcher_access')
    ), qualified_sources as (
        select source.id as transcript_id,
            source.redacted_source_version as source_version,
            offer.respondent_id
        from target
        join public.transcripts as source on source.study_id = target.study_id
        join public.answers as answer on answer.id = source.answer_id
        join public.sessions as interview on interview.id = answer.session_id
        join public.invites as offer on offer.id = interview.invite_id
        join approved on approved.respondent_id = offer.respondent_id
        join public.quality_scores as quality on quality.session_id = interview.id
        join internal.gate1_answer_jobs as job on job.answer_id = answer.id
        where interview.study_id = target.study_id
            and interview.state in ('approved', 'paid')
            and interview.submitted_at is not null
            and offer.study_id = target.study_id and offer.state = 'accepted'
            and quality.decision = 'approve'
            and not exists (select 1 from public.removals as removal
                where removal.session_id = interview.id)
            and source.redacted_text is not null and job.result_status = 'published'
            and internal.gate3_policy_qualified(job.publication_policy_digest,
                job.publication_qualification_digest)
            and exists (select 1 from internal.gate1_processing_input(answer.id) as input
                where input.source_hash = job.source_hash
                    and input.processing_revision = job.processing_revision
                    and input.publication_revision = job.publication_revision)
    )
    select jsonb_build_object('reportId', target.id, 'studyId', target.study_id,
        'findings', coalesce((select jsonb_agg(jsonb_build_object(
            'id', finding.id, 'position', finding.position) order by finding.position)
            from public.findings as finding where finding.report_id = target.id),
            '[]'::jsonb),
        'approvedRespondentIds', coalesce((select jsonb_agg(
            respondent_id order by respondent_id) from approved), '[]'::jsonb),
        'sourceRespondents', coalesce((select jsonb_agg(jsonb_build_object(
            'transcriptId', transcript_id, 'sourceVersion', source_version,
            'respondentId', respondent_id) order by transcript_id)
            from qualified_sources), '[]'::jsonb),
        'reviewedSupport', coalesce((select jsonb_agg(jsonb_build_object(
            'position', finding.position, 'sources', manifest.sources_json)
            order by finding.position)
            from pii.gate3_reviewed_support_manifests as manifest
            join public.findings as finding on finding.id = manifest.finding_id
            where manifest.report_id = target.id), '[]'::jsonb))
    from target;
$$;
revoke all on function public.read_gate3_reviewed_support_snapshot(uuid)
    from public, anon, authenticated, service_role;
grant execute on function public.read_gate3_reviewed_support_snapshot(uuid)
    to service_role;
