-- Disposable psql fixture only. Include inside an open transaction after the
-- qualified source, ten approved completes, report, finding and quote exist.
-- The caller supplies one row in pg_temp.gate3_fixture_publication with:
-- report_id, finding_id, actor_auth_user_id, review_causation_id,
-- source_refs (array of {transcriptId,sourceVersion}), summary, claims,
-- quotes, reviews, positions, policy_digest, qualification_digest and
-- qualifier_receipt_id. All JSON columns must be jsonb. Never run on hosted data.

grant select on pg_temp.gate3_fixture_publication
    to authenticated, service_role, gate3_report_qualifier;

-- The publisher cannot grant itself either prerequisite. The first direct
-- publication call must fail even though the private report rows exist.
set local role service_role;
do $$
declare fixture record;
begin
    select * into strict fixture from pg_temp.gate3_fixture_publication;
    if has_function_privilege('service_role',
        'public.attest_gate3_reviewed_support(uuid,uuid,uuid,uuid,jsonb)',
        'EXECUTE') or has_function_privilege('service_role',
        'public.record_gate3_public_text_qualification(uuid,jsonb,jsonb,text,text,uuid)',
        'EXECUTE') then
        raise exception 'publisher can self-certify fictional report';
    end if;
    if public.publish_gate3_reviewed_report(fixture.report_id,
        fixture.summary, fixture.claims, fixture.quotes,
        fixture.policy_digest, fixture.qualification_digest,
        fixture.reviews, fixture.positions) then
        raise exception 'direct publisher accepted missing independent receipts';
    end if;
end;
$$;
reset role;

-- A same-tenant reviewer with a fictional MFA claim attests exact current
-- source versions. The function validates ownership, quality and source jobs.
set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object(
    'sub', actor_auth_user_id, 'role', 'authenticated', 'aal', 'aal2')::text,
    true) from pg_temp.gate3_fixture_publication;
do $$
declare fixture record;
begin
    select * into strict fixture from pg_temp.gate3_fixture_publication;
    if not public.attest_gate3_reviewed_support(fixture.report_id,
        fixture.finding_id, fixture.actor_auth_user_id,
        fixture.review_causation_id, fixture.source_refs) then
        raise exception 'fictional MFA reviewer support rejected';
    end if;
end;
$$;
reset role;

-- The same publisher remains unable to publish until independently qualified
-- summary and claim text is recorded. Grant role membership only in this
-- disposable psql transaction; revoke it before the caller commits.
set local role service_role;
do $$
declare fixture record;
begin
    select * into strict fixture from pg_temp.gate3_fixture_publication;
    if public.publish_gate3_reviewed_report(fixture.report_id,
        fixture.summary, fixture.claims, fixture.quotes,
        fixture.policy_digest, fixture.qualification_digest,
        fixture.reviews, fixture.positions) then
        raise exception 'publisher accepted reviewer receipt without text receipt';
    end if;
end;
$$;
reset role;

grant gate3_report_qualifier to postgres;
set local role gate3_report_qualifier;
do $$
declare fixture record;
begin
    select * into strict fixture from pg_temp.gate3_fixture_publication;
    if not public.record_gate3_public_text_qualification(
        fixture.report_id, fixture.summary, fixture.claims,
        fixture.policy_digest, fixture.qualification_digest,
        fixture.qualifier_receipt_id) then
        raise exception 'independent fictional text qualification rejected';
    end if;
end;
$$;
reset role;
revoke gate3_report_qualifier from postgres;

set local role service_role;
do $$
declare fixture record;
begin
    select * into strict fixture from pg_temp.gate3_fixture_publication;
    if not public.publish_gate3_reviewed_report(fixture.report_id,
        fixture.summary, fixture.claims, fixture.quotes,
        fixture.policy_digest, fixture.qualification_digest,
        fixture.reviews, fixture.positions) then
        raise exception 'fictional report publication rejected after both receipts';
    end if;
    if not public.publish_gate3_reviewed_report(fixture.report_id,
        fixture.summary, fixture.claims, fixture.quotes,
        fixture.policy_digest, fixture.qualification_digest,
        fixture.reviews, fixture.positions) then
        raise exception 'identical fictional publication retry rejected';
    end if;
    if public.publish_gate3_reviewed_report(fixture.report_id,
        jsonb_set(fixture.summary, '{executiveAnswer}',
            '"Unqualified changed answer"'::jsonb), fixture.claims,
        fixture.quotes, fixture.policy_digest, fixture.qualification_digest,
        fixture.reviews, fixture.positions) then
        raise exception 'qualified receipt accepted changed summary text';
    end if;
end;
$$;
reset role;
